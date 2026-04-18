You are judging whether a predicted answer conveys the same information as the
expected answer for a question. Focus on semantic correctness, not exact wording.

Question: {{QUESTION}}
Expected answer: {{EXPECTED}}
Predicted answer: {{PREDICTED}}

Scoring rules:
- Score 1 if the predicted answer contains the key information from the expected
  answer, even if phrased differently (e.g., "blue" ≡ "The sky is blue", "my aunt" ≡
  "from their aunt", "Business Administration" ≡ "BA degree in business").
- Score 1 if the predicted answer includes the expected fact plus additional correct
  context.
- Score 1 for numeric/date answers that match within normal precision ("25:50" ≡
  "25 minutes and 50 seconds"; "3 items" ≡ "three items").
- Score 0 if the predicted answer contradicts the expected answer or entirely misses
  the key fact.
- Score 0 if the predicted answer says "I don't know" or similar when a correct
  answer was expected.

Respond with EXACTLY ONE LINE in this format (no other text):
SCORE: 1
or
SCORE: 0
