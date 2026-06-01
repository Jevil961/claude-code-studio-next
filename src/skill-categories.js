import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CC_SKILLS_ROOT = join(homedir(), ".cc-switch", "skills");

export const CATEGORIES = {
  coding: { name: "编程开发", icon: "💻", color: "#4fc3f7" },
  "security-web": { name: "Web安全", icon: "🌐", color: "#ef5350" },
  "security-injection": { name: "注入攻击", icon: "💉", color: "#ff7043" },
  "security-auth": { name: "认证鉴权", icon: "🔐", color: "#ab47bc" },
  "security-binary": { name: "二进制/逆向", icon: "⚙️", color: "#7e57c2" },
  "security-os": { name: "系统安全", icon: "🖥️", color: "#5c6bc0" },
  "security-infra": { name: "基础设施", icon: "🏗️", color: "#26a69a" },
  "security-crypto": { name: "密码学", icon: "🔑", color: "#ffa726" },
  "security-mobile": { name: "移动安全", icon: "📱", color: "#66bb6a" },
  "security-misc": { name: "综合安全", icon: "🛡️", color: "#78909c" },
  other: { name: "其他", icon: "📦", color: "#bdbdbd" },
};

// Name-based classification rules (priority order)
const NAME_RULES = [
  // Coding / Dev tools
  { pattern: /^(tdd|prototype|improve-codebase|caveman|diagnose|handoff|zoom-out|to-issues|to-prd|write-a-skill|find-skills|grill-me|grill-with-docs|triage|setup-matt)/, category: "coding" },

  // Crypto
  { pattern: /(rsa-attack|lattice-crypto|symmetric-cipher|classical-cipher|hash-attack|crypto)/, category: "security-crypto" },

  // Mobile
  { pattern: /(android-pentesting|ios-pentesting|mobile-ssl|mobile)/, category: "security-mobile" },

  // Binary / RE
  { pattern: /(heap-exploitation|stack-overflow|format-string|anti-debugging|binary-protection|vm-and-bytecode|code-obfuscation|browser-exploitation|arbitrary-write|symbolic-execution|reverse-eng)/, category: "security-binary" },

  // OS
  { pattern: /(linux-privilege|windows-privilege|linux-lateral|windows-lateral|kernel-exploitation|container-escape|sandbox-escape|windows-av-evasion|reverse-shell)/, category: "security-os" },

  // Infra
  { pattern: /(kubernetes|dns-rebinding|subdomain-takeover|network-protocol|tunneling|traffic-analysis|active-directory|ntlm-relay)/, category: "security-infra" },

  // Auth
  { pattern: /(api-sec|api-auth|api-authorization|jwt-oauth|oauth-oidc|saml-sso|authbypass|401-403-bypass)/, category: "security-auth" },

  // Injection
  { pattern: /(cmdi|nosql-injection|expression-language|jndi-injection|xslt-injection|graphql|http-parameter|prototype-pollution|injection-checking)/, category: "security-injection" },

  // Web
  { pattern: /(xss|sqli|ssrf|ssti|csrf|cors|clickjacking|open-redirect|crlf|csp-bypass|http-host-header|request-smuggling|websocket|web-cache|path-traversal|file-access|upload-insecure|dangling-markup|csv-formula|email-header|ghost-bits|waf-bypass|http2-specific)/, category: "security-web" },
];

// Description-based fallback keywords
const DESC_KEYWORDS = {
  coding: ["development", "programming", "code review", "test-driven", "architecture", "prototyping", "workflow", "productivity"],
  "security-web": ["web application", "xss", "injection", "csrf", "cors", "redirect", "smuggling", "cache poisoning"],
  "security-injection": ["injection", "command injection", "sql injection", "template injection", "expression language"],
  "security-auth": ["authentication", "authorization", "jwt", "oauth", "saml", "token", "session", "login"],
  "security-binary": ["binary", "exploitation", "reverse engineering", "buffer overflow", "heap", "stack", "debugger"],
  "security-os": ["privilege escalation", "lateral movement", "kernel", "container escape", "sandbox", "persistence"],
  "security-infra": ["kubernetes", "dns", "network", "active directory", "kerberos", "ntlm", "tunneling"],
  "security-crypto": ["cryptographic", "rsa", "cipher", "hash", "encryption", "decryption"],
  "security-mobile": ["android", "ios", "mobile", "apk", "ipa", "ssl pinning"],
  "security-misc": ["waf bypass", "reconnaissance", "forensics", "steganography", "smart contract", "race condition"],
};

export function classifySkill(skillDir) {
  const name = skillDir.toLowerCase();

  // 1. Check name rules
  for (const rule of NAME_RULES) {
    if (rule.pattern.test(name)) return rule.category;
  }

  // 2. Try reading SKILL.md description
  const skillMd = join(CC_SKILLS_ROOT, skillDir, "SKILL.md");
  if (existsSync(skillMd)) {
    try {
      const content = readFileSync(skillMd, "utf8").toLowerCase().slice(0, 2000);
      for (const [cat, keywords] of Object.entries(DESC_KEYWORDS)) {
        for (const kw of keywords) {
          if (content.includes(kw)) return cat;
        }
      }
    } catch {}
  }

  // 3. Check if it looks like a security skill (default for unknown)
  const securityIndicators = ["exploit", "attack", "vulnerability", "bypass", "injection", "escalation", "abuse"];
  const desc = (existsSync(skillMd) ? readFileSync(skillMd, "utf8").toLowerCase() : name);
  if (securityIndicators.some(ind => desc.includes(ind))) return "security-misc";

  return "other";
}

export function categorizeAllSkills(skills) {
  return skills.map(skill => ({
    ...skill,
    category: classifySkill(skill.directory),
  }));
}

export function getSkillsByCategory(categorizedSkills) {
  const groups = {};
  for (const cat of Object.keys(CATEGORIES)) groups[cat] = [];
  for (const skill of categorizedSkills) {
    const cat = skill.category || "other";
    if (!groups[cat]) groups[cat] = [];
    groups[cat].push(skill);
  }
  return groups;
}

export function getCategoryInfo(categoryId) {
  return CATEGORIES[categoryId] || CATEGORIES.other;
}
