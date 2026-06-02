import { data } from "../state.js";

export function classifyPlugin(plugin) {
  const haystack = ((plugin.name || "") + " " + (plugin.description || "")).toLowerCase();
  const rules = [
    ["coding", /(tdd|prototype|caveman|diagnose|handoff|code.?review|refactor|workflow|productivity|dev(elopment)?\b|programming|git\b|build|test|compile)/],
    ["security-web", /(xss|sqli|ssrf|csrf|cors|web\b|http|browser|frontend|clickjack|redirect|smuggl|waf.?bypass|upload|traversal)/],
    ["security-injection", /(injection|cmdi|sql|template|command|custom.?inject|nosql|expression|jndi|prototype.?pollution)/],
    ["security-auth", /(auth|jwt|oauth|saml|token|session|login|permission|bypass.*auth|401|403)/],
    ["security-binary", /(binary|exploit|reverse|buffer|heap|stack|debug|disassembl|asm|shellcode|rop|format.?string)/],
    ["security-os", /(privilege|lateral|kernel|container|sandbox|persist|linux|windows\b|system\b|root|sudo|av.?evasion)/],
    ["security-infra", /(kubernetes|dns\b|network|active.?directory|kerberos|ntlm|tunnel|proxy|scan|recon|enum)/],
    ["security-crypto", /(crypto|rsa|cipher|hash|encrypt|decrypt|signing|lattice)/],
    ["security-mobile", /(android|ios|mobile|apk|ipa|swift|kotlin|ssl.?pin)/],
    ["security-misc", /(security|pentest|red.?team|blue.?team|vulnerab|exploit|attack|waf|forensic|stegano|race.?condition|smart.?contract|social.?engineer)/],
  ];
  for (const [cat, pat] of rules) { if (pat.test(haystack)) return cat; }
  return "other";
}

export function selectedSkillDirsForCategory(catData, catSkills) {
  if (!catData?.enabled) return [];
  const available = new Set(catSkills.filter(s => s.inCcSwitch !== false).map(s => s.directory));
  const entries = Object.entries(catData.skills || {}).filter(([dir]) => available.has(dir));
  if (!entries.length) return [...available];
  const hasExplicitInclude = entries.some(([, enabled]) => enabled === true);
  if (hasExplicitInclude) return entries.filter(([, enabled]) => enabled === true).map(([dir]) => dir);
  const excluded = new Set(entries.filter(([, enabled]) => enabled === false).map(([dir]) => dir));
  return [...available].filter(dir => !excluded.has(dir));
}

export function resolvedIdentitySkillDirs(identity) {
  const dirs = [];
  for (const [catId, catData] of Object.entries(identity?.categories || {})) {
    const catSkills = (data.categorizedSkills || data.skills || []).filter(s => s.category === catId);
    dirs.push(...selectedSkillDirsForCategory(catData, catSkills));
  }
  return [...new Set(dirs)];
}
