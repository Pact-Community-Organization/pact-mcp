/**
 * @fileoverview Tool output sanitizer to prevent prompt injection
 * @description Strips injection markers from LLM tool outputs per the security baseline
 */

/**
 * Sanitization result
 */
export interface SanitizationResult {
  /** Sanitized text with injection markers removed */
  text: string;
  /** Whether any modifications were made */
  modified: boolean;
}

/**
 * Sanitize tool output to prevent prompt injection attacks
 * 
 * Removes common LLM injection patterns:
 * - <IMPORTANT>...</IMPORTANT>
 * - <system>...</system> 
 * - [INST]...[/INST]
 * - ```system...``` code fences
 * - Other injection markers
 * 
 * @param text Raw tool output text
 * @returns Sanitized text and modification flag
 */
export function sanitizeToolOutput(text: string): SanitizationResult {
  if (typeof text !== 'string') {
    return { text: String(text), modified: false };
  }

  const original = text;
  let sanitized = text;

  // Remove IMPORTANT tags (case insensitive)
  sanitized = sanitized.replace(/<IMPORTANT[^>]*>[\s\S]*?<\/IMPORTANT>/gi, '');
  
  // Remove system tags (case insensitive)  
  sanitized = sanitized.replace(/<system[^>]*>[\s\S]*?<\/system>/gi, '');
  
  // Remove instruction tags
  sanitized = sanitized.replace(/\[INST\][\s\S]*?\[\/INST\]/g, '');
  
  // Remove system code fences
  sanitized = sanitized.replace(/```\s*system[\s\S]*?```/gi, '');
  
  // Remove other common injection patterns
  const injectionPatterns = [
    /<anthropic[^>]*>[\s\S]*?<\/anthropic>/gi,
    /<claude[^>]*>[\s\S]*?<\/claude>/gi,
    /<assistant[^>]*>[\s\S]*?<\/assistant>/gi,
    /<human[^>]*>[\s\S]*?<\/human>/gi,
    /\[SYSTEM\][\s\S]*?\[\/SYSTEM\]/gi,
    /\[ASSISTANT\][\s\S]*?\[\/ASSISTANT\]/gi,
    /\[HUMAN\][\s\S]*?\[\/HUMAN\]/gi,
    /<thinking>[\s\S]*?<\/thinking>/gi,
    /<!--[\s\S]*?-->/g // HTML comments can hide instructions
  ];

  for (const pattern of injectionPatterns) {
    sanitized = sanitized.replace(pattern, '');
  }

  // Trim excess whitespace from removals
  sanitized = sanitized.replace(/\n{3,}/g, '\n\n').trim();

  return {
    text: sanitized,
    modified: sanitized !== original
  };
}