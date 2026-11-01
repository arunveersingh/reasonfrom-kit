/** A small, realistic, valid bundle input. Tests mutate copies of it. */
export function validInput() {
  return {
    source: {
      repo: 'arunveersingh/example',
      sha: 'a'.repeat(40),
      url: 'https://github.com/arunveersingh/example',
    },
    items: [
      {
        meta: {
          id: 'course/fail-safely',
          title: 'Fail Safely',
          tagline: 'Mechanisms, not pep talks.',
          source_url: 'https://github.com/arunveersingh/example/tree/main/course',
          cover: 'fail-safely/day-01.svg',
          outline: {
            unit: 'day',
            line_label: 'Failure',
            phases: [
              { label: 'Failures', from: 1, to: 2, question: 'What broke?' },
              { label: 'Guardrails', from: 3, to: 3 },
            ],
            entries: [
              { n: 1, title: 'Confident Wrongness', line: 'False claim, sure tone', phase: 'Failures' },
              { n: 2, title: 'Silent Assumptions', line: 'Premises become facts', phase: 'Failures' },
              { n: 3, title: 'Self-Graded Green', line: 'The grader is the author', phase: 'Guardrails' },
            ],
          },
        },
      },
      {
        meta: {
          id: 'lesson/fail-safely/day-01',
          course: 'course/fail-safely',
          n: 1,
          title: 'Day 1 — Confident Wrongness',
          description: 'A false claim arrives in the same tone as a true one.',
          phase: 'Failures',
          line: 'False claim, sure tone',
          time: '~15 min',
        },
        body: [
          '![diagram](rf-asset:fail-safely/day-01.svg)',
          '',
          'Next: [Day 2](rf:lesson/fail-safely/day-02). Practice with [mirror-test](rf:skill/mirror-test).',
          'Source: [repo](https://github.com/arunveersingh/example). Jump [down](#exercise).',
          '',
          '<img src="rf-asset:fail-safely/slides/slide-1.png" alt="slide 1">',
          '',
          '## Exercise',
        ].join('\n'),
      },
      {
        meta: {
          id: 'lesson/fail-safely/day-02',
          course: 'course/fail-safely',
          n: 2,
          title: 'Day 2 — Silent Assumptions',
          description: 'Unstated premises become facts.',
          phase: 'Failures',
          publish_at: '2026-12-01',
        },
        body: 'Back to [Day 1](rf:lesson/fail-safely/day-01).',
      },
      {
        meta: {
          id: 'skill/mirror-test',
          name: 'mirror-test',
          description: 'Re-asks a question with your belief removed, then reversed.',
          version: '1.0',
          resource: 'truth',
          symptom: 'The AI agrees with whatever framing you bring.',
          license: 'Apache-2.0',
          source_url: 'https://github.com/arunveersingh/example/blob/main/skills/mirror-test/SKILL.md',
          evals: { cases: 5, url: 'https://github.com/arunveersingh/example/blob/main/evals/skills/mirror-test.md' },
        },
        body: '# Mirror Test\n\nYou test whether a conclusion survives a change of framing.',
      },
    ],
    assets: [
      { path: 'fail-safely/day-01.svg', data: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>\n') },
      { path: 'fail-safely/slides/slide-1.png', data: Buffer.from([0x89, 0x50, 0x4e, 0x47]) },
    ],
  };
}

export const clone = (v) => structuredClone(v);
