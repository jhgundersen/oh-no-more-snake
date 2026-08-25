// Party Mode's ear — a Web Audio port of `src/musiccontroller.cpp`.
//
// The desktop version taps QMediaPlayer's decoded buffers and analyses them by
// hand. An AnalyserNode gives the same access here, so the analysis below is
// the same analysis: one-pole filters split the signal into three bands, mean
// square energy against a rolling average finds onsets, and a bank of Goertzel
// resonators produces the 48-band spectrum the board and the snake are painted
// from. Nothing here is an FFT display; it is the same numbers driving the same
// effects.
//
// Two things a browser changes. Playback cannot start without a user gesture,
// so `toggle()` must be called from an event handler — which it always is, and
// eating a disco ball only happens after several keystrokes. And a page cannot
// read `~/.local/share/omasnake/music`, so custom tracks arrive by drag and
// drop instead, for the length of the session.

const BUILT_IN = [
  { url: "snake/soundtrack_10.mp3", name: "Byte Me Maybe" },
  { url: "snake/soundtrack_11.mp3", name: "Hiss It Till You Make It" },
  { url: "snake/soundtrack_8.mp3", name: "Another Byte Hisses the Dust" },
  { url: "snake/soundtrack_9.mp3", name: "Sweet Child O' Python" },
  { url: "snake/soundtrack_12.mp3", name: "Every Breath You Snake" },
  { url: "snake/soundtrack_13.mp3", name: "Smells Like Serpent Spirit" },
  { url: "snake/soundtrack_14.mp3", name: "Enter Sandboa" },
  { url: "snake/soundtrack_15.mp3", name: "Wake Me Up Before You Boa-Go" }
]

// Boss tracks are not part of the playlist: `n` does not cycle through them,
// and they interrupt what is playing rather than replacing it. Whatever was on
// is remembered, down to the second, and put back afterwards.
const BOSS_TRACKS = [
  { url: "snake/boss_1.mp3", name: "Cathedral of Iron Scales" },
  { url: "snake/boss_2.mp3", name: "Rusted Iron Hiss" }
]

const BANDS = 48
const FFT_SIZE = 2048
const PLAYING_VOLUME = 0.55
const HISTORY = 32

export class MusicController {
  constructor({ store = null } = {}) {
    this.store = store
    this.listeners = new Map()

    this.tracks = BUILT_IN.map(track => ({ ...track, builtIn: true }))
    this.track = 0
    this.enabled = false
    this.gameActive = true
    this.volume = PLAYING_VOLUME

    this.bass = 0
    this.mid = 0
    this.treble = 0
    this.spectrum = new Float64Array(BANDS)
    this.leadSpectrum = new Float64Array(BANDS)
    this.spectrumBaseline = new Float64Array(BANDS)
    this.previousSpectrum = new Float64Array(BANDS)
    this.rawBands = new Float64Array(BANDS)
    this.spectrumPrimed = false

    this.lowPass = 0
    this.midPass = 0
    this.energyHistory = []
    this.lastOnset = -1
    this.sinceAnalysis = 0

    this.context = null
    this.analyser = null
    this.gain = null
    this.playlistGain = null
    this.bossGain = null
    this.samples = null
    this.playlistLevel = 1
    this.bossLevel = 0

    this.element = new Audio()
    this.element.preload = "none"
    this.element.crossOrigin = "anonymous"
    this.element.addEventListener("ended", () => this.nextTrack())
    // The saved position is applied once the browser knows the duration.
    this.element.addEventListener("loadedmetadata", () => {
      if (this.resumePosition > 0) {
        this.element.currentTime = Math.min(this.resumePosition, this.element.duration || 0)
      }
      this.resumePosition = 0
    })

    this.resumePosition = 0

    // A boss track has to land at full volume while the playlist is still
    // fading out underneath it, and one element cannot play two things. So
    // there are two, mixed before the analyser — which is also why Party Mode
    // reacts to whatever is actually audible during the handover.
    this.bossElement = new Audio()
    this.bossElement.preload = "none"
    this.bossElement.crossOrigin = "anonymous"
    this.bossElement.loop = true // a duel outlasts a track more often than not
    this.bossTrack = null

    this.loadState()
    this.element.src = this.tracks[this.track].url
    setInterval(() => this.saveState(), 5000)
    addEventListener("pagehide", () => this.saveState())
  }

  on(event, handler) {
    if (!this.listeners.has(event)) this.listeners.set(event, [])
    this.listeners.get(event).push(handler)
    return this
  }

  emit(event, ...args) {
    const handlers = this.listeners.get(event)
    if (handlers) for (const handler of handlers) handler(...args)
  }

  get trackName() {
    return this.bossTrack ? this.bossTrack.name : this.tracks[this.track]?.name || "No tracks"
  }

  get inBossTrack() {
    return Boolean(this.bossTrack)
  }

  get bossTrackCount() {
    return BOSS_TRACKS.length
  }

  // Steps aside for a boss. The playlist element is simply left paused where
  // it stands, so there is no position to remember — it is still holding it.
  async enterBossTrack(index) {
    if (this.bossTrack) return
    this.bossTrack = BOSS_TRACKS[((index % BOSS_TRACKS.length) + BOSS_TRACKS.length) % BOSS_TRACKS.length]
    this.energyHistory = []
    this.lastOnset = -1
    this.bossElement.src = this.bossTrack.url
    // No load() here: setting src already starts one, and asking to play in
    // the same breath makes the browser abort the request it just began.
    // Straight in at full: a challenger does not fade up.
    this.setBossLevel(1)
    if (this.enabled && this.gameActive) await this.play()
    this.emit("trackChanged")
  }

  // Back to the playlist, at the second it was interrupted at, because the
  // element never moved.
  async leaveBossTrack() {
    if (!this.bossTrack) return
    this.bossTrack = null
    this.energyHistory = []
    this.lastOnset = -1
    if (this.enabled && this.gameActive) await this.play()
    this.emit("trackChanged")
  }

  // Called by whichever fade is finished with an element.
  stopBossElement() {
    this.bossElement.pause()
    this.setBossLevel(0)
  }

  stopPlaylistElement() {
    this.element.pause()
    this.setPlaylistLevel(0)
  }

  // --- graph ---

  // Built on the first gesture that starts playback, because a context created
  // before one exists starts suspended and stays that way.
  ensureGraph() {
    if (this.context) return
    const Context = globalThis.AudioContext || globalThis.webkitAudioContext
    if (!Context) return
    this.context = new Context()
    this.analyser = this.context.createAnalyser()
    this.analyser.fftSize = FFT_SIZE
    // The analysis wants raw windows, not a smoothed magnitude display.
    this.analyser.smoothingTimeConstant = 0

    // Each element has its own level for the handover; `gain` is the volume of
    // the whole thing, which is what pausing and dying fade.
    this.playlistGain = this.context.createGain()
    this.playlistGain.gain.value = this.playlistLevel
    this.bossGain = this.context.createGain()
    this.bossGain.gain.value = this.bossLevel
    this.gain = this.context.createGain()
    this.gain.gain.value = this.volume

    this.context.createMediaElementSource(this.element).connect(this.playlistGain)
    this.context.createMediaElementSource(this.bossElement).connect(this.bossGain)
    this.playlistGain.connect(this.analyser)
    this.bossGain.connect(this.analyser)
    this.analyser.connect(this.gain)
    this.gain.connect(this.context.destination)
    this.samples = new Float32Array(this.analyser.fftSize)
  }

  // The mix between the two elements: 1 and 0 is the playlist alone.
  setPlaylistLevel(level) {
    this.playlistLevel = Math.max(0, Math.min(1, level))
    if (this.playlistGain) this.playlistGain.gain.value = this.playlistLevel
  }

  setBossLevel(level) {
    this.bossLevel = Math.max(0, Math.min(1, level))
    if (this.bossGain) this.bossGain.gain.value = this.bossLevel
  }

  // Whichever element should be making the noise right now.
  get currentElement() {
    return this.bossTrack ? this.bossElement : this.element
  }

  get playing() {
    return !this.element.paused || !this.bossElement.paused
  }

  setVolume(volume) {
    this.volume = Math.max(0, Math.min(1, volume))
    if (this.gain) this.gain.gain.value = this.volume
    this.emit("volumeChanged")
  }

  // --- transport ---

  async play() {
    this.ensureGraph()
    try {
      // The element is started before the context is resumed, and the resume is
      // never awaited: a context suspended by the autoplay policy stays
      // suspended until a gesture arrives, and awaiting it would hang here
      // instead of reporting that playback was refused.
      this.context?.resume().catch(() => {})
      await this.currentElement.play()
      return true
    } catch (error) {
      // Only a refusal is a refusal. An AbortError means a load interrupted
      // the request — the audio starts a moment later anyway, and treating
      // that as "autoplay was blocked" switched Party Mode off mid-fight.
      if (error?.name !== "NotAllowedError") return false
      // Say so rather than leaving the button claiming a party that is not
      // happening.
      this.enabled = false
      this.pauseAll()
      this.emit("enabledChanged")
      this.emit("blocked")
      return false
    }
  }

  toggle() {
    this.enabled = !this.enabled
    if (this.enabled && this.gameActive) this.play()
    else this.pauseAll()
    this.emit("enabledChanged")
  }

  pauseAll() {
    this.element.pause()
    this.bossElement.pause()
  }

  nextTrack() {
    this.saveState()
    if (!this.tracks.length) return
    this.track = (this.track + 1) % this.tracks.length
    this.resumePosition = 0
    this.loadTrack()
    // During a duel the playlist element is paused and silent, so a new track
    // loads into it without interrupting anything. It is simply what will be
    // playing once the fight is over.
    if (this.enabled && this.gameActive && !this.bossTrack) this.play()
    this.saveState()
    this.emit("trackChanged")
  }

  selectTrack(index) {
    if (index < 0 || index >= this.tracks.length || index === this.track) return
    this.saveState()
    this.track = index
    this.resumePosition = 0
    this.loadTrack()
    if (this.enabled && this.gameActive) this.play()
    this.emit("trackChanged")
  }

  loadTrack() {
    this.energyHistory = []
    this.lastOnset = -1
    this.element.src = this.tracks[this.track].url
    this.element.load()
  }

  // Pause and death fade to silence first, then suspend the player here.
  setGameActive(active) {
    if (this.gameActive === active) return
    this.gameActive = active
    if (!this.enabled) return
    if (active) this.play()
    else this.pauseAll()
  }

  // Dropped files stand in for `~/.local/share/omasnake/music`. Object URLs do
  // not survive a reload, so these are a session's playlist, not a library.
  addLocalTracks(files) {
    const audio = [...files].filter(file => /^audio\//.test(file.type) || /\.(mp3|ogg|flac|wav|m4a)$/i.test(file.name))
    if (!audio.length) return 0
    audio.sort((a, b) => a.name.localeCompare(b.name))
    for (const file of audio) {
      this.tracks.push({
        url: URL.createObjectURL(file),
        name: file.name.replace(/\.[^.]+$/, ""),
        builtIn: false
      })
    }
    this.track = this.tracks.length - audio.length
    this.resumePosition = 0
    this.loadTrack()
    if (this.enabled && this.gameActive) this.play()
    this.emit("trackChanged")
    return audio.length
  }

  // --- persistence ---

  loadState() {
    if (!this.store) return
    try {
      const saved = this.store.getItem("omasnake/music/track")
      const index = this.tracks.findIndex(track => track.url === saved)
      this.track = index >= 0
        ? index
        : Math.max(0, Math.min(this.tracks.length - 1, Number(this.store.getItem("omasnake/music/trackIndex")) || 0))
      this.resumePosition = Math.max(0, Number(this.store.getItem("omasnake/music/position")) || 0)
    } catch {
      this.track = 0
      this.resumePosition = 0
    }
  }

  saveState() {
    if (!this.store || !this.tracks.length) return
    // The playlist element holds its own position whether or not a boss track
    // is playing over the top of it, so this needs no special case.
    const index = this.track
    const position = this.element.currentTime || 0
    const current = this.tracks[index]
    try {
      // A blob URL is meaningless next session; remember the built-in it would
      // otherwise overwrite instead.
      if (current.builtIn) this.store.setItem("omasnake/music/track", current.url)
      this.store.setItem("omasnake/music/trackIndex", current.builtIn ? index : 0)
      this.store.setItem("omasnake/music/position", current.builtIn ? position : 0)
    } catch {
      // Storage is a convenience here, never a requirement.
    }
  }

  // --- analysis ---

  // Called every animation frame; runs the analysis at roughly the cadence a
  // decoded audio buffer would have arrived at on the desktop, because the
  // smoothing constants below were tuned per buffer, not per frame.
  update(deltaMs, now) {
    if (!this.enabled || !this.analyser || !this.playing) return
    const interval = (this.analyser.fftSize / this.context.sampleRate) * 1000
    this.sinceAnalysis += deltaMs
    if (this.sinceAnalysis < interval) return
    this.sinceAnalysis = 0

    this.analyser.getFloatTimeDomainData(this.samples)
    this.updateSpectrum()

    const energy = this.meanSquare()
    let average = 0
    for (const value of this.energyHistory) average += value
    if (this.energyHistory.length) average /= this.energyHistory.length
    if (this.energyHistory.length >= 8 && energy > 0.00008 && energy > average * 1.55
      && (this.lastOnset < 0 || now - this.lastOnset > 90)) {
      this.registerOnset(now, average > 0 ? energy / average : 0)
    }
    this.energyHistory.push(energy)
    while (this.energyHistory.length > HISTORY) this.energyHistory.shift()
  }

  meanSquare() {
    let sum = 0
    for (const sample of this.samples) sum += sample * sample
    return sum / this.samples.length
  }

  updateSpectrum() {
    const samples = this.samples
    const sampleRate = this.context.sampleRate
    const count = samples.length

    // Two one-pole low passes split the signal three ways: what the 180 Hz
    // filter keeps is bass, what the 2200 Hz one adds is mid, what neither
    // kept is treble.
    const lowAlpha = (2 * Math.PI * 180) / (sampleRate + 2 * Math.PI * 180)
    const midAlpha = (2 * Math.PI * 2200) / (sampleRate + 2 * Math.PI * 2200)
    let low = this.lowPass
    let mid = this.midPass
    let lowEnergy = 0
    let midEnergy = 0
    let highEnergy = 0
    for (let i = 0; i < count; ++i) {
      const sample = samples[i]
      low += lowAlpha * (sample - low)
      mid += midAlpha * (sample - mid)
      const midBand = mid - low
      const highBand = sample - mid
      lowEnergy += low * low
      midEnergy += midBand * midBand
      highEnergy += highBand * highBand
    }
    this.lowPass = low
    this.midPass = mid

    const level = value => Math.max(0, Math.min(1, Math.sqrt(value / count) * 4.5))
    this.bass = this.bass * 0.72 + level(lowEnergy) * 0.28
    this.mid = this.mid * 0.72 + level(midEnergy) * 0.28
    this.treble = this.treble * 0.72 + level(highEnergy) * 0.28

    const maximumFrequency = Math.min(16000, sampleRate * 0.45)
    for (let band = 0; band < BANDS; ++band) {
      const fraction = (band + 0.5) / BANDS
      const frequency = 55 * Math.pow(maximumFrequency / 55, fraction)
      // One Goertzel resonator per band: cheaper than an FFT when only 48
      // logarithmically spaced bins are wanted, and it is what the desktop does.
      const coefficient = 2 * Math.cos((2 * Math.PI * frequency) / sampleRate)
      let previous = 0
      let previous2 = 0
      for (let i = 0; i < count; ++i) {
        const current = samples[i] + coefficient * previous - previous2
        previous2 = previous
        previous = current
      }
      const power = Math.max(0, previous * previous + previous2 * previous2 - coefficient * previous * previous2)
      const raw = Math.max(0, Math.min(1, (Math.sqrt(power) / count) * 9))
      this.rawBands[band] = raw

      // Follow falling energy quickly but rising energy slowly. What remains
      // above this local floor is a transient, rather than permanent glow.
      let baseline = this.spectrumPrimed ? this.spectrumBaseline[band] : raw
      baseline = raw < baseline ? baseline * 0.88 + raw * 0.12 : baseline * 0.985 + raw * 0.015
      this.spectrumBaseline[band] = baseline

      const previousRaw = this.spectrumPrimed ? this.previousSpectrum[band] : raw
      const rise = Math.max(0, raw - previousRaw)
      const threshold = 0.01 + baseline * 0.075
      const activity = Math.max(0, Math.min(1, (rise - threshold) * 8))
      this.previousSpectrum[band] = raw

      const old = this.spectrum[band]
      const retention = activity > old ? 0.34 : 0.54
      this.spectrum[band] = old * retention + activity * (1 - retention)
    }

    // A second pass finds bands standing out from their neighbours inside the
    // melodic range. That is the lead line, and it is what the snake wears.
    for (let band = 0; band < BANDS; ++band) {
      const fraction = (band + 0.5) / BANDS
      const frequency = 55 * Math.pow(maximumFrequency / 55, fraction)
      let neighbours = 0
      let neighbourCount = 0
      for (let offset = -2; offset <= 2; ++offset) {
        if (offset === 0 || band + offset < 0 || band + offset >= BANDS) continue
        neighbours += this.rawBands[band + offset]
        ++neighbourCount
      }
      neighbours /= Math.max(1, neighbourCount)
      const prominence = Math.max(0, this.rawBands[band] - neighbours * 1.1)
      const melodic = frequency >= 160 && frequency <= 6500
        ? Math.max(0, Math.min(1, prominence * 9))
        : 0
      const old = this.leadSpectrum[band]
      const retention = melodic > old ? 0.46 : 0.82
      this.leadSpectrum[band] = old * retention + melodic * (1 - retention)
    }

    this.spectrumPrimed = true
    this.emit("spectrumChanged")
  }

  registerOnset(now, strength) {
    this.lastOnset = now
    this.emit("onset")
    if (strength >= 1.95) this.emit("strongBeat", Math.max(0, Math.min(1, (strength - 1.95) / 1.5)))
  }
}

// Reads one range of the spectrum as a single level, so a 48-band analysis can
// paint a snake of any length. Ported from `spectrumRange` in the QML.
export function spectrumRange(values, index, count) {
  if (!values.length || count < 1) return 0
  const first = Math.floor((index * values.length) / count)
  const last = Math.max(first + 1, Math.floor(((index + 1) * values.length) / count))
  let total = 0
  let peak = 0
  for (let band = first; band < last && band < values.length; ++band) {
    total += values[band]
    peak = Math.max(peak, values[band])
  }
  return Math.min(1, peak * 0.68 + (total / (last - first)) * 0.32)
}
