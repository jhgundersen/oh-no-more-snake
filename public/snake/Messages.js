// The message pools, copied verbatim from `src/Main.qml` in the Qt version.
//
// Keep them geeky, gently sarcastic, and free of elapsed-time references. Both
// halves of a pair matter: a level-clear line is read by someone still playing,
// a game-over line by someone who just stopped.

export const levelMessages = [
  "Productivity remains at zero.",
  "The build is still compiling.",
  "Please update your résumé accordingly.",
  "Nobody had a stopwatch out. Nobody was watching either.",
  "MacGyver would have used fewer apples.",
  "The snake requests a raise.",
  "Your inbox did not clear itself.",
  "History declines to comment.",
  "Confetti remains out of scope.",
  "The Nokia 3310 nods respectfully.",
  "Captain's Log: somehow adequate.",
  "Transporter buffer intact. Dignity status unknown.",
  "The wall union is furious.",
  "Please hold your applause indefinitely.",
  "Donkey Kong threw one pity barrel.",
  "Your real work remains undefeated.",
  "Achievement value: statistically negligible.",
  "Resistance was apparently optional.",
  "The agent may have finished without you.",
  "The Prime Directive remains technically unbroken.",
  "Your manager sensed a disturbance.",
  "Stand by for no rewards whatsoever.",
  "The leaderboard is just you, by the way.",
  "Please return to pretending to work.",
  "Your keyboard would like a union representative.",
  "You outsmarted a grid of rectangles.",
  "Several pixels were mildly inconvenienced.",
  "A tiny parade has been cancelled.",
  "The apples have filed a complaint.",
  "The cloud bill remains unchanged.",
  "Somewhere, a sprint goal quietly slips.",
  "Quality assurance found no quality.",
  "The snake calls this synergy.",
  "Garbage collector reports no recoverable ambition.",
  "Achievement unlocked: horizontal scaling.",
  "One small step for snake, no progress for mankind.",
  "The next wall has read the incident report.",
  "This result will not survive peer review.",
  "Your terminal has seen enough.",
  "Works on your machine. Unfortunately."
]

export const gameOverMessages = [
  "The wall was there the whole time.",
  "Segmentation fault: snake met boundary.",
  "Task failed successfully.",
  "The snake has left the call unexpectedly.",
  "Have you tried turning yourself off and on again?",
  "This incident has been assigned to you.",
  "No pixels were harmed. Your pride was.",
  "The postmortem will blame human error.",
  "You found an undocumented stopping condition.",
  "The wall passed all integration tests.",
  "Your coworkers think you're deep in thought.",
  "The snake remembers glory. Briefly.",
  "Somewhere, a rubber duck is disappointed.",
  "Zero regrets. Okay, one regret.",
  "The agent finished. You did not.",
  "Achievement unlocked: avoidable outage.",
  "The snake deserved better observability.",
  "Nokia hardware would have survived that.",
  "MacGyver requests fewer keyboard privileges.",
  "Set phasers to mildly disappointed.",
  "Resistance was futile. The wall won.",
  "Pac-Man's ghosts have better incident response.",
  "Please file a ticket with yourself.",
  "Root cause identified between chair and keyboard.",
  "The rollback plan is pressing Space.",
  "Production is down. Fortunately, this is not production.",
  "Your snake has been OOM-killed by geometry.",
  "The logs contain nothing useful, as tradition demands.",
  "This is why we cannot have infinite loops.",
  "The boundary condition would like credit.",
  "A blameless postmortem will still mention your name.",
  "The snake exited with code: embarrassing.",
  "DNS was not responsible this time.",
  "Kubernetes cannot reschedule this snake.",
  "The compiler warned you in spirit.",
  "Your high availability strategy needs another snake.",
  "The cache was warm. Your reflexes were not.",
  "Please restore dignity from the latest backup.",
  "The merge request has been politely declined.",
  "Game over. Ship it anyway.",
  "The snake encountered a layer-eight problem.",
  "A senior engineer will call this expected behavior.",
  "The happy path ended one cell ago.",
  "You have successfully reproduced the bug.",
  "The monitoring dashboard is now extremely red.",
  "There is no SLA for this level of performance.",
  "Your snake's warranty has been voided.",
  "Please stand by while nothing is recovered.",
  "The wall has requested a performance bonus.",
  "At least the failure was deterministic."
]

// The combo meter names ×1 through ×10, in order.
export const partyComboNames = [
  "Casual Chewing",
  "Deadline Dining",
  "Turbo Takeout",
  "Fork Bomb Buffet",
  "Cache-Hit Cuisine",
  "Latency-Free Lunch",
  "Overclocked Omnivore",
  "Continuous Ingestion",
  "Distributed Digestion",
  "Zero-Day Dessert"
]

export const partyComboName = multiplier =>
  partyComboNames[(multiplier - 1) % partyComboNames.length]

// One message per event, never the same one twice running.
export function pickDifferent(messages, previous) {
  if (messages.length < 2) return messages.length ? messages[0] : ""
  let next = previous
  while (next === previous) next = messages[Math.floor(Math.random() * messages.length)]
  return next
}
