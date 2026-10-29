// Pawnbreaker build config — the only file to touch when plugging services in.
// Feedback: SilentForms (https://silentforms.com) — the access key is public by design: it can only route submissions
// to the confirmed inbox below (mgrachev+pawnbreaker@mail.grokbot.com); it cannot read anything.
// Analytics: 'local' keeps anonymous events on this device only (attached to feedback). To go live, set ONE line, e.g.
//   analytics: { provider: 'goatcounter', goatcounter: 'pawnbreaker' }              // https://pawnbreaker.goatcounter.com
//   analytics: { provider: 'plausible', plausibleDomain: 'pawnbreaker.me' }
//   analytics: { provider: 'umami', umamiHost: 'https://cloud.umami.is', umamiWebsite: '<website-id>' }
window.PB_CONFIG = {
  version: '0.3.0-alpha', versionLabel: 'Alpha v0.3',
  feedback: { endpoint: 'https://silentforms.com/api/submit', accessKey: '15f051dac920487ad556db7a7f52e7c8388a67b8ca74ddb947c6ac85cb845a74', mailto: 'mgrachev+pawnbreaker@mail.grokbot.com' },
  analytics: { provider: 'local' }
};
