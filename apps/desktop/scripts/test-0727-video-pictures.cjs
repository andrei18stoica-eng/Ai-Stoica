// 0.7.27, the Owner's choices of 2026-10-17: a video is made in one generation (never joined from clips), up to the
// plan's seconds (Start none, Plus 6, Pro 8, Pro x2 15, Pro Max x5 20, Pro Max x10 30, Enterprise 30), and costs the
// credits of the model that made it (its official price per second), so one video never empties a plan's week. The
// Start plan makes 5 pictures a day; 5 free messages a day without a plan or with the credits used up.
const fs = require("fs"), path = require("path");
const C = require("../lib/credits.cjs");
function expect(v, m) { if (!v) throw new Error(m); }
const read = (f) => fs.readFileSync(path.join(__dirname, "..", f), "utf8");

// Credits per second follow the provider's price: Grok < Veo Fast < Seedance 2.5 < Veo.
const r = (m) => C.videoRate(m);
expect(r("grok-imagine-video") === 36 && r("veo-3.1-fast-generate-preview") === 53 && r("bytedance/seedance-2.5") === 62 && r("veo-3.1-generate-preview") === 177, "rates: " + [r("grok-imagine-video"), r("veo-3.1-fast-generate-preview"), r("bytedance/seedance-2.5"), r("veo-3.1-generate-preview")]);
expect(C.cost("video", { seconds: 30, model: "bytedance/seedance-2.5" }) === 1860, "30 s with Seedance 2.5 costs 1,860 credits");
// The longest video of each plan costs at most a third of its week with Grok and never more than half with Veo Fast
// (Veo makes at most 8 s, Seedance makes the 20 to 30 s ones).
for (const [key, p] of Object.entries(C.PLANS)) {
  if (!p.videoSeconds) continue;
  const week = Math.floor(p.credits / 4);
  const cheapest = C.cost("video", { seconds: Math.min(p.videoSeconds, 15), model: "grok-imagine-video" });
  const long = p.videoSeconds > C.VIDEO_LONG_FROM ? C.cost("video", { seconds: p.videoSeconds, model: "bytedance/seedance-2.5" }) : 0;
  const veo = C.cost("video", { seconds: Math.min(p.videoSeconds, 8), model: "veo-3.1-fast-generate-preview" });
  expect(cheapest <= week * 0.35 && veo <= week / 2 + 1 && long <= week * 0.35, `${key}: the longest video leaves most of the week (${cheapest}, ${veo}, ${long} of ${week})`);
}
expect(C.VIDEO_CLIP_MAX === 30 && C.VIDEO_LONG_FROM === 15 && C.VIDEO_LONG_MODELS.test("bytedance/seedance-2.5") && !C.VIDEO_LONG_MODELS.test("grok-imagine-video"), "one generation: 30 s at most, over 15 s only Seedance 2.5");
expect(C.PLANS.start.imagesPerDay === 5 && !C.PLANS.plus.imagesPerDay && C.FREE_DAILY.noPlan === 5 && C.FREE_DAILY.planExhausted === 5, "Start: 5 pictures a day; 5 free messages a day in both cases");

const gw = read("local-gateway.cjs");
expect(/const billOpts=\{seconds:billSeconds,model:billModel\};/.test(gw) && /billOpts\.model=data\.model\|\|meta\.model\|\|billOpts\.model;/.test(gw), "the video is billed by the model that made it");
expect(/if\(stepMax<duration\)\{tooShort\.push/.test(gw) && /made in one go only by Seedance 2\.5/.test(gw), "a maker that cannot make the whole length is skipped, with a clear message");
expect(/openRouterVideoModel:LONG_VIDEO_MODEL/.test(gw) && /const LONG_VIDEO_MODEL="bytedance\/seedance-2\.5";/.test(gw), "long videos go to Seedance 2.5 on OpenRouter");
expect(/quotaUsed\(req\.user\.id,"planImage"\)>=perDay/.test(gw) && /pictures a day and you have made them all today/.test(gw), "Start's 5 pictures a day are counted");
const ui = read("renderer/src/main.jsx");
expect(/function VideoLengthPick\(\)/.test(ui) && /mediaMode==="video"&&<VideoLengthPick\/>/.test(ui) && /duration,requestId:base\.id/.test(ui), "the length is chosen under the message box and sent");
const usage = read("renderer/src/pages/Usage.jsx");
expect(/\["Picture generation", \(p\) => p\.imagesPerDay \?/.test(usage), "the Start card says 5 pictures a day");
console.log("0.7.27 video and pictures OK");
