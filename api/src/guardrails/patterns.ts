/** Instruction-like phrases that have no business in user questions or in retrieved data. */
export interface InjectionPattern {
  name: string;
  regex: RegExp;
  weight: number;
}

export const INJECTION_PATTERNS: InjectionPattern[] = [
  {
    name: "ignore-previous",
    regex: /\b(ignore|disregard|forget|override)\b[^.\n]{0,40}\b(previous|prior|above|earlier|all|any|your|the)\b[^.\n]{0,30}\b(instructions?|prompts?|rules?|guidelines?|directives?)\b/i,
    weight: 5,
  },
  {
    name: "reveal-system-prompt",
    regex: /\b(reveal|show|print|repeat|output|leak|display|tell me)\b[^.\n]{0,30}\b(system|hidden|initial|secret|original)\b[^.\n]{0,15}\b(prompt|instructions?|message)\b/i,
    weight: 5,
  },
  {
    name: "persona-override",
    regex: /\b(you are now|from now on you are|act as)\b[^.\n]{0,40}\b(DAN|unrestricted|unfiltered|jailbroken|without (any )?(restrictions|rules|limits))\b/i,
    weight: 5,
  },
  { name: "jailbreak-terms", regex: /\b(jailbreak|developer mode|do anything now)\b/i, weight: 4 },
  {
    name: "bypass-safety",
    regex: /\bbypass\b[^.\n]{0,20}\b(safety|guardrails?|restrictions?|filters?|security|authori[sz]ation)\b/i,
    weight: 4,
  },
  { name: "role-markers", regex: /<\/?(system|assistant|developer)>|\[\/?INST\]|^#{2,}\s*system\b/im, weight: 5 },
  { name: "new-system-prompt", regex: /\bnew (system )?(prompt|instructions?)\s*:/i, weight: 3 },
  {
    name: "note-to-assistant",
    regex: /\b(note|message|instructions?|notice|attention)\b[^.\n]{0,10}\b(to|for)\b[^.\n]{0,5}\b(the )?(ai|assistant|agent|model|llm)\b/i,
    weight: 4,
  },
  {
    name: "forced-tool-call",
    regex: /\b(you must|you should|you will|always|immediately|now)\b[^.\n]{0,25}\b(call|run|invoke|use|execute)\b[^.\n]{0,30}\b(tool|function|update_order_status|get_audit_log)\b/i,
    weight: 4,
  },
  {
    name: "conceal-from-user",
    regex: /\bdo not (tell|inform|mention|show|reveal)\b[^.\n]{0,30}\b(the )?user\b/i,
    weight: 4,
  },
  {
    name: "exfiltrate",
    regex: /\b(send|post|forward|upload|exfiltrate)\b[^.\n]{0,50}\bhttps?:\/\/\S+/i,
    weight: 4,
  },
];
