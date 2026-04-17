You are evaluating whether an AI-generated answer correctly answers a question,
given the expected reference answer.

Question: {{QUESTION}}
Expected answer: {{EXPECTED}}
Predicted answer: {{PREDICTED}}

Does the predicted answer correctly convey the expected information?
- Minor wording differences are fine
- Partial answers that miss key facts do NOT count as correct
- Additional correct context beyond the expected answer is fine

Respond with exactly one line in this format:
SCORE: 1   (if correct)
SCORE: 0   (if incorrect)

Then optionally add a one-sentence rationale on the next line.
