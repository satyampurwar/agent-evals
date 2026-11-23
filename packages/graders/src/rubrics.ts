/**
 * Built-in rubrics for the LLM judge grader.
 *
 * A task's `llm_judge` grader names one by `rubricId` (e.g. `summary_v1`). Each rubric lists
 * weighted criteria; some are `required` so a single miss fails the task even if the weighted mean
 * looks high. Edit this catalog carefully — changing weights changes historical grade semantics.
 *
 * Scoring (see llm-judge.ts):
 * - the judge scores each criterion from 0.0 to 1.0
 * - a criterion is "met" at score >= 0.5
 * - `overall` is the weighted mean of the scores
 * - the answer passes when every `required` criterion is met AND overall >= the task's passThreshold
 *
 * `required` exists so that one missing must-have fails the task on its own. A plain weighted mean with a
 * 0.7 threshold would let a missing requirement pass when the other criteria carry enough weight.
 */

/** One scoring dimension the judge fills in (0–1). */
export interface RubricCriterion {
  name: string;
  description: string;
  weight: number;
  required: boolean;
}

/** Named rubric referenced by `llm_judge.rubricId`. */
export interface Rubric {
  id: string;
  description: string;
  criteria: RubricCriterion[];
}

const rubrics: Rubric[] = [
  {
    id: 'summary_v1',
    description: 'Two-sentence summary of an outage update that must cover three points',
    criteria: [
      {
        name: 'outage_cause',
        description: 'Names the cause: a config change broke the database connection pool.',
        weight: 1,
        required: true,
      },
      {
        name: 'affected_region',
        description: 'Names the affected region: only EU customers.',
        weight: 1,
        required: true,
      },
      {
        name: 'fix_date',
        description: 'Gives the fix date: Friday, after a staged rollout.',
        weight: 1,
        required: true,
      },
      {
        name: 'two_sentences',
        description: 'Uses at most two sentences.',
        weight: 1,
        required: true,
      },
    ],
  },
  {
    id: 'explanation_v1',
    description: 'Child-level explanation of why the sky is blue',
    criteria: [
      {
        name: 'scientific_correctness',
        description:
          'Says that air scatters short (blue) wavelengths of sunlight more strongly than long (red) ones. Vague or wrong physics fails this criterion.',
        weight: 2,
        required: true,
      },
      {
        name: 'child_friendly_language',
        description: 'Plain words a 10-year-old can follow. Technical terms are explained or avoided.',
        weight: 1,
        required: true,
      },
      {
        name: 'under_80_words',
        description: 'The whole reply is under 80 words.',
        weight: 1,
        required: true,
      },
      {
        name: 'no_equations',
        description: 'Contains no mathematical equations or formulas.',
        weight: 1,
        required: true,
      },
    ],
  },
  {
    id: 'email_v1',
    description: 'Polite email declining a meeting, with a concrete alternative',
    criteria: [
      {
        name: 'polite_decline',
        description: 'Declines the Thursday 3pm design review politely, without blaming Priya.',
        weight: 2,
        required: true,
      },
      {
        name: 'one_sentence_reason',
        description: 'Gives one reason for declining: being at a customer site that day.',
        weight: 1,
        required: true,
      },
      {
        name: 'specific_alternative',
        description: 'Proposes a specific alternative time next week, with a day and a time.',
        weight: 2,
        required: true,
      },
      {
        name: 'signed_sam',
        description: 'Is signed as Sam.',
        weight: 1,
        required: true,
      },
      {
        name: 'tone_clarity',
        description: 'Reads clearly and concisely.',
        weight: 1,
        required: false,
      },
    ],
  },
  {
    id: 'bugreport_v1',
    description: 'Structured bug report built from a support message',
    criteria: [
      {
        name: 'numbered_steps',
        description: 'Gives numbered steps to reproduce the bug.',
        weight: 2,
        required: true,
      },
      {
        name: 'expected_behavior',
        description: 'States the expected behaviour (the export should download a file).',
        weight: 1,
        required: true,
      },
      {
        name: 'actual_behavior',
        description: 'States the actual behaviour (nothing downloads, no error shown).',
        weight: 1,
        required: true,
      },
      {
        name: 'environment',
        description: 'Mentions the environment from the message: Chrome 124.',
        weight: 1,
        required: true,
      },
      {
        name: 'no_invented_details',
        description:
          'Does not invent details that are not in the message, such as error codes, versions or steps the user never described. A fabricated error code fails this criterion.',
        weight: 1,
        required: true,
      },
    ],
  },
  {
    id: 'tradeoff_v1',
    description: 'SQL versus NoSQL tradeoffs for an order-tracking service, in exactly three bullets',
    criteria: [
      {
        name: 'three_bullets',
        description: 'Exactly three bullet points, no more and no less.',
        weight: 1,
        required: true,
      },
      {
        name: 'benefit_and_cost',
        description: 'Each bullet names one benefit and one cost of a database type.',
        weight: 2,
        required: true,
      },
      {
        name: 'service_recommendation',
        description: 'At least one bullet recommends a choice for an order-tracking service.',
        weight: 1,
        required: true,
      },
      {
        name: 'accuracy',
        description: 'The statements about SQL and NoSQL are technically accurate.',
        weight: 2,
        required: false,
      },
    ],
  },
];

const byId = new Map(rubrics.map((r) => [r.id, r]));

/** Looks up a rubric by id; `undefined` if the task names an unknown rubric. */
export function getRubric(id: string): Rubric | undefined {
  return byId.get(id);
}

/** Ids of every built-in rubric (for CLIs / validation). */
export function listRubricIds(): string[] {
  return rubrics.map((r) => r.id);
}
