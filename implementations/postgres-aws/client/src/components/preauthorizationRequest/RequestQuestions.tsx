import { useState } from 'react';
import { answerPreauthorizationQuestion, apiErrorMessage, askPreauthorizationQuestion, type PreauthorizationRequestDetail } from '../../api/client';
import { formatDateTime } from '../../formatDateTime';
import { Notice } from '../ui/Notice';
import { Button } from '../ui/Button';

export function Questions({ detail, staff, mayAnswer, onChanged }: { detail: PreauthorizationRequestDetail; staff: boolean; mayAnswer: boolean; onChanged: (next: PreauthorizationRequestDetail) => void }) {
  const [question, setQuestion] = useState('');
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const open = detail.request.statusCode === 'submitted' || detail.request.statusCode === 'info_requested';
  const id = detail.request.preauthorizationRequestId;
  return (
    <section className="card compact-card">
      <h2>Questions</h2>
      {error && <Notice tone="danger">{error}</Notice>}
      {detail.questions.length === 0 && <p className="muted">No questions asked.</p>}
      {detail.questions.map((row) => (
        <div key={row.preauthorizationQuestionId} className="preauth-question">
          <p>
            <strong>{row.question}</strong>
            <span className="cell-note">{row.askedByName}, {formatDateTime(row.askedAt)}</span>
          </p>
          {row.answer ? (
            <p>
              {row.answer}
              <span className="cell-note">{row.answeredByName}, {row.answeredAt ? formatDateTime(row.answeredAt) : ''}</span>
            </p>
          ) : (
            open &&
            mayAnswer && (
              <div className="preauth-message">
                <label className="usa-sr-only" htmlFor={`answer-${row.preauthorizationQuestionId}`}>Answer</label>
                <textarea
                  id={`answer-${row.preauthorizationQuestionId}`}
                  className="usa-textarea"
                  placeholder={staff ? 'Record the answer you were given' : 'Your answer'}
                  value={answers[row.preauthorizationQuestionId] ?? ''}
                  onChange={(event) => setAnswers({ ...answers, [row.preauthorizationQuestionId]: event.target.value })}
                />
                <Button
                  kind="secondary"
                  disabled={!answers[row.preauthorizationQuestionId]?.trim()}
                  onClick={() =>
                    answerPreauthorizationQuestion(id, row.preauthorizationQuestionId, answers[row.preauthorizationQuestionId]!.trim()).then(onChanged, (err: unknown) =>
                      setError(apiErrorMessage(err, 'The answer could not be saved.')),
                    )
                  }
                >
                  {staff ? 'Record answer' : 'Send answer'}
                </Button>
              </div>
            )
          )}
        </div>
      ))}
      {staff && open && (
        <div className="preauth-message">
          <label className="usa-sr-only" htmlFor="preauth-ask">Ask the requester</label>
          <textarea id="preauth-ask" className="usa-textarea" placeholder="Ask the requester for more information" maxLength={2000} value={question} onChange={(event) => setQuestion(event.target.value)} />
          <Button
            kind="secondary"
            disabled={!question.trim()}
            onClick={() =>
              askPreauthorizationQuestion(id, question.trim()).then(
                (next) => {
                  setQuestion('');
                  onChanged(next);
                },
                (err: unknown) => setError(apiErrorMessage(err, 'The question could not be sent.')),
              )
            }
          >
            Ask
          </Button>
        </div>
      )}
    </section>
  );
}
