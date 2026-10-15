import { describe, it, expect } from 'vitest';
import { parseOmriAssessment, OMRI_PROMPT_LAYOUT } from './omriAssessment.js';

const body = '## Reasoning\n\nNeem oil is listed at §205.601(e).\n\n## Key Concerns\n\n- Check the label';

describe('parseOmriAssessment', () => {
  it.each([
    ['Likely Allowed', 'allowed'],
    ['Allowed with Restrictions', 'restricted'],
    ['Likely Prohibited', 'prohibited'],
    ['Cannot Determine', 'unknown'],
  ])('reads "STATUS: %s" as %s and takes the line out of the text', (words, status) => {
    const out = parseOmriAssessment(`STATUS: ${words}\n\n${body}`);
    expect(out.status).toBe(status);
    expect(out.body).toBe(body);
    expect(out.body).not.toMatch(/STATUS/);
  });

  it('gives a fixed, plain label for each status, whatever words the model used', () => {
    expect(parseOmriAssessment('STATUS: Likely Allowed\n\nx').label).toBe('Likely Allowed');
    expect(parseOmriAssessment('STATUS: allowed with restrictions - verify\n\nx').label).toBe('Allowed with Restrictions');
    expect(parseOmriAssessment('STATUS: Cannot Determine (verify at omri.org)\n\nx').label).toBe('Cannot Determine — verify at omri.org');
  });

  it('does not take "Allowed with Restrictions — verify" for allowed or for unknown', () => {
    expect(parseOmriAssessment('STATUS: Allowed with Restrictions — verify\n\nx').status).toBe('restricted');
  });

  it('copes with bold, a leading "Likely", a different case and spaces around the colon', () => {
    expect(parseOmriAssessment('**Status:** Likely Prohibited\n\nx').status).toBe('prohibited');
    expect(parseOmriAssessment('  LIKELY STATUS : likely allowed\n\nx').status).toBe('allowed');
  });

  it('still understands an older answer that used the emoji marks, and removes them from the text', () => {
    const out = parseOmriAssessment('LIKELY STATUS: ✅ Likely Allowed\n\nREASONING: fine.');
    expect(out.status).toBe('allowed');
    expect(out.body).toBe('REASONING: fine.');
    expect(parseOmriAssessment('⚠️ Allowed with Restrictions — verify\n\nmore').status).toBe('restricted');
    expect(parseOmriAssessment('❌ Likely Prohibited\n\nmore').status).toBe('prohibited');
    expect(parseOmriAssessment('❓ Cannot Determine\n\nmore').status).toBe('unknown');
  });

  it('keeps the whole text when there is no status to find', () => {
    const out = parseOmriAssessment('Some text without a verdict.');
    expect(out.status).toBeNull();
    expect(out.label).toBe('');
    expect(out.body).toBe('Some text without a verdict.');
  });

  it('copes with empty and non-text input', () => {
    for (const v of ['', null, undefined, 5]) expect(parseOmriAssessment(v)).toEqual({ status: null, label: '', body: '' });
  });

  it('only looks near the top of the answer, so a later sentence with "status" is not taken for the verdict', () => {
    const text = `Intro paragraph.\n\n${'filler line\n'.repeat(10)}STATUS: Likely Allowed`;
    expect(parseOmriAssessment(text).status).toBeNull();
  });
});

describe('parseOmriAssessment: more cases', () => {
  it('takes a verdict that mentions both "prohibited" and "cannot determine" as prohibited', () => {
    expect(parseOmriAssessment('STATUS: Likely Prohibited (cannot determine the formulation)\n\nx').status).toBe('prohibited');
  });

  it('finds the verdict after a title line or blank lines', () => {
    const out = parseOmriAssessment('\n\n**Assessment**\nSTATUS: Likely Allowed\n\nBody text');
    expect(out.status).toBe('allowed');
    expect(out.body).toBe('**Assessment**\n\nBody text');
  });

  it('trims the text when there is no verdict', () => {
    expect(parseOmriAssessment('  \nSome text  \n').body).toBe('Some text');
  });

  it('reads Windows line endings', () => {
    expect(parseOmriAssessment('STATUS: Likely Allowed\r\n\r\n## Reasoning\r\n\r\nText').body).toBe('## Reasoning\n\nText');
  });
});

describe('parseOmriAssessment: wording that must not turn into the wrong badge', () => {
  it.each([
    'Not allowed', 'Disallowed', 'Likely Not Allowed', 'Not permitted', 'Isn\'t allowed', 'Not Allowed in organic production',
  ])('reads "%s" as prohibited, never as allowed', (words) => {
    expect(parseOmriAssessment(`STATUS: ${words}\n\nx`).status).toBe('prohibited');
  });

  it('shows no badge for a verdict it does not recognise, and keeps the line in the text', () => {
    const out = parseOmriAssessment('STATUS: Probably fine\n\n## Reasoning\n\nx');
    expect(out.status).toBeNull();
    expect(out.label).toBe('');
    expect(out.body).toContain('STATUS: Probably fine');
  });

  it('still lets a later line be the verdict when an earlier STATUS line is not recognised', () => {
    const out = parseOmriAssessment('STATUS: Probably fine\nSTATUS: Likely Allowed\n\nx');
    expect(out.status).toBe('allowed');
  });
});

describe('parseOmriAssessment: the four verdicts win over the words around them', () => {
  it.each([
    ['Likely Allowed \u2014 not prohibited under \u00A7205.601', 'allowed'],
    ['Likely Allowed (verify at omri.org)', 'allowed'],
    ['Allowed', 'allowed'],
    ['Likely Prohibited \u2014 not allowed in organic crop production', 'prohibited'],
    ['Allowed with Restrictions (not allowed on edible parts)', 'restricted'],
    ['Allowed with conditions', 'restricted'],
    ['Allowed only for seed treatment', 'restricted'],
    ['Cannot Determine \u2014 not enough detail to say whether it is allowed', 'unknown'],
  ])('reads "%s" as %s', (words, status) => {
    expect(parseOmriAssessment(`STATUS: ${words}\n\nx`).status).toBe(status);
  });

  it.each([
    'Not Likely Allowed', 'Non-allowed substance', 'Not likely to be allowed', 'Nonpermitted', 'No, not allowed', 'Never allowed',
  ])('reads "%s" as prohibited, however it is phrased', (words) => {
    expect(parseOmriAssessment(`STATUS: ${words}\n\nx`).status).toBe('prohibited');
  });
});

describe('parseOmriAssessment: verdicts that do not start with one of the four', () => {
  it.each([
    ['Probably prohibited', 'prohibited'],
    ['Unclear \u2014 depends on the formulation', 'unknown'],
    ['Unknown', 'unknown'],
    ['Subject to restrictions on edible parts', 'restricted'],
    ['Permitted under conditions', 'restricted'],
    ['Mostly allowed', 'allowed'],
  ])('reads "%s" as %s', (words, status) => {
    expect(parseOmriAssessment(`STATUS: ${words}\n\nx`).status).toBe(status);
  });

  it('keeps "Cannot Determine" even when the words go on to mention what is not allowed', () => {
    expect(parseOmriAssessment('STATUS: Cannot Determine whether it is not allowed\n\nx').status).toBe('unknown');
  });
});

describe('OMRI_PROMPT_LAYOUT', () => {
  it('asks for a plain STATUS line with one of the four verdicts, then headed sections, and no emoji', () => {
    expect(OMRI_PROMPT_LAYOUT).toMatch(/STATUS:/);
    for (const verdict of ['Likely Allowed', 'Allowed with Restrictions', 'Likely Prohibited', 'Cannot Determine']) expect(OMRI_PROMPT_LAYOUT).toContain(verdict);
    expect(OMRI_PROMPT_LAYOUT).toMatch(/## Reasoning/);
    expect(OMRI_PROMPT_LAYOUT).toMatch(/## Key Concerns/);
    expect(OMRI_PROMPT_LAYOUT).toMatch(/## Verification Step/);
    expect(OMRI_PROMPT_LAYOUT).not.toMatch(/[✅❌❓⚠]/);
  });
});
