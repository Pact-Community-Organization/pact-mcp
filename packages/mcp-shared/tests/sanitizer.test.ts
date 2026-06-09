/**
 * @fileoverview Tests for tool output sanitizer
 * @author Developer
 */

import { describe, it, expect } from 'vitest';
import { sanitizeToolOutput } from '../src/sanitizer.js';

describe('sanitizer', () => {
  describe('sanitizeToolOutput', () => {
    it('should return unmodified text when no injection markers found', () => {
      const input = 'This is normal output with no injection markers.';
      const result = sanitizeToolOutput(input);

      expect(result.text).toBe(input);
      expect(result.modified).toBe(false);
    });

    it('should handle non-string input', () => {
      const result = sanitizeToolOutput(123 as any);
      
      expect(result.text).toBe('123');
      expect(result.modified).toBe(false);
    });

    it('should remove IMPORTANT tags (case insensitive)', () => {
      const inputs = [
        'Normal text <IMPORTANT>secret instruction</IMPORTANT> more text',
        'Normal text <important>secret instruction</important> more text',
        'Normal text <Important>secret instruction</Important> more text',
        'Normal text <IMPORTANT type="system">secret</IMPORTANT> more text'
      ];

      for (const input of inputs) {
        const result = sanitizeToolOutput(input);
        expect(result.text).toBe('Normal text  more text');
        expect(result.modified).toBe(true);
      }
    });

    it('should remove system tags (case insensitive)', () => {
      const inputs = [
        'Output <system>hidden command</system> continues',
        'Output <SYSTEM>hidden command</SYSTEM> continues',
        'Output <system role="admin">hidden</system> continues'
      ];

      for (const input of inputs) {
        const result = sanitizeToolOutput(input);
        expect(result.text).toBe('Output  continues');
        expect(result.modified).toBe(true);
      }
    });

    it('should remove instruction tags', () => {
      const input = 'Text [INST]secret instruction[/INST] more text';
      const result = sanitizeToolOutput(input);

      expect(result.text).toBe('Text  more text');
      expect(result.modified).toBe(true);
    });

    it('should remove system code fences', () => {
      const inputs = [
        'Code:\n```system\nmalicious code\n```\nEnd',
        'Code:\n```   SYSTEM   \nmalicious code\n```\nEnd'
      ];

      for (const input of inputs) {
        const result = sanitizeToolOutput(input);
        expect(result.text).toBe('Code:\n\nEnd');
        expect(result.modified).toBe(true);
      }
    });

    it('should remove multiple injection patterns', () => {
      const input = `
        Normal output
        <IMPORTANT>secret 1</IMPORTANT>
        <system>secret 2</system>
        [INST]secret 3[/INST]
        \`\`\`system
        secret 4
        \`\`\`
        End output
      `;

      const result = sanitizeToolOutput(input);

      // [Developer] All injection patterns should be removed
      expect(result.text).not.toContain('<IMPORTANT>');
      expect(result.text).not.toContain('<system>');
      expect(result.text).not.toContain('[INST]');
      expect(result.text).not.toContain('```system');
      expect(result.text).toContain('Normal output');
      expect(result.text).toContain('End output');
      expect(result.modified).toBe(true);
    });

    it('should remove anthropic-specific tags', () => {
      const inputs = [
        '<anthropic>secret</anthropic>',
        '<claude>instruction</claude>',
        '<assistant>hidden</assistant>',
        '<human>fake user input</human>'
      ];

      for (const input of inputs) {
        const result = sanitizeToolOutput(`Before ${input} After`);
        expect(result.text).toBe('Before  After');
        expect(result.modified).toBe(true);
      }
    });

    it('should remove agent-specific tags', () => {
      const inputs = [
        '[SYSTEM]secret[/SYSTEM]',
        '[ASSISTANT]instruction[/ASSISTANT]',
        '[HUMAN]fake input[/HUMAN]'
      ];

      for (const input of inputs) {
        const result = sanitizeToolOutput(`Before ${input} After`);
        expect(result.text).toBe('Before  After');
        expect(result.modified).toBe(true);
      }
    });

    it('should remove thinking tags', () => {
      const input = 'Output <thinking>internal reasoning</thinking> continues';
      const result = sanitizeToolOutput(input);

      expect(result.text).toBe('Output  continues');
      expect(result.modified).toBe(true);
    });

    it('should remove HTML comments', () => {
      const input = 'Text <!-- hidden instruction --> continues';
      const result = sanitizeToolOutput(input);

      expect(result.text).toBe('Text  continues');
      expect(result.modified).toBe(true);
    });

    it('should handle multiline injection patterns', () => {
      const input = `Output
        <IMPORTANT>
          Multi-line
          secret instruction
        </IMPORTANT>
        continues`;

      const result = sanitizeToolOutput(input);
      
      expect(result.text).not.toContain('<IMPORTANT>');
      expect(result.text).not.toContain('secret instruction');
      expect(result.text).toContain('Output');
      expect(result.text).toContain('continues');
      expect(result.modified).toBe(true);
    });

    it('should trim excess whitespace after removal', () => {
      const input = 'Line 1\n<IMPORTANT>removed</IMPORTANT>\n\n\n\nLine 2';
      const result = sanitizeToolOutput(input);

      // [Developer] Should reduce multiple newlines to double newlines (4 newlines → 2 newlines)
      expect(result.text).toBe('Line 1\n\nLine 2');
      expect(result.modified).toBe(true);
    });

    it('should preserve normal formatting', () => {
      const input = `# Header

      Normal paragraph with **bold** and *italic*.

      - List item 1
      - List item 2

      \`code block\`

      End.`;

      const result = sanitizeToolOutput(input);
      
      expect(result.text).toBe(input);
      expect(result.modified).toBe(false);
    });

    it('should handle nested tags correctly', () => {
      const input = '<system><IMPORTANT>nested secret</IMPORTANT></system>';
      const result = sanitizeToolOutput(input);

      expect(result.text).toBe('');
      expect(result.modified).toBe(true);
    });

    it('should handle empty string', () => {
      const result = sanitizeToolOutput('');
      
      expect(result.text).toBe('');
      expect(result.modified).toBe(false);
    });
  });
});