import { useState } from 'react';
import { MAX_QUESTION_LENGTH, type ReviewQuestion } from '../api/client';
import { formatDateTime } from '../formatDateTime';

// The reviewer's brief questions to the submitter about a line, and their
// answers, kept on the invoice (model/rules.yaml ask_review_question). Review
// waits until every question is answered. Everyone sees them in a row under
// their line, where the submitter answers.

type AnswerProps = {
  staff: boolean;
  canAnswer: boolean;
  saving: boolean;
  // Resolves true once saved.
  onAnswer: (questionId: string, answer: string) => Promise<boolean>;
};

// The question and its answer on the left; answering on the right, or below
// once open.
function QuestionItem({ question, staff, canAnswer, saving, onAnswer }: { question: ReviewQuestion } & AnswerProps) {
  const open = !question.answeredAt;
  return (
    <li className={`line-question${open ? ' line-question--open' : ''}`}>
      <div className="line-question__body">
        <p className="line-question__meta">
          <strong>{staff ? 'Question' : 'Question from the billing office'}</strong>
          {' · '}
          {staff ? `${question.askedByDisplayName ?? 'The reviewer'}, ` : ''}
          {formatDateTime(question.askedAt)}
          {open && ' · Not answered yet'}
        </p>
        <p>{question.question}</p>
        {question.answeredAt && (
          <>
            <p className="line-question__meta line-question__meta--answer">
              <strong>Answer</strong>
              {' · '}
              {staff && question.answeredByDisplayName ? `recorded by ${question.answeredByDisplayName}, ` : ''}
              {formatDateTime(question.answeredAt)}
            </p>
            <p>{question.answer}</p>
          </>
        )}
      </div>
      {open && canAnswer && (
        <AnswerForm staff={staff} saving={saving} onAnswer={(answer) => onAnswer(question.invoiceReviewQuestionId, answer)} />
      )}
    </li>
  );
}

// One line's questions, in the full-width row under it.
export function LineQuestions({ questions, ...answer }: { questions: ReviewQuestion[] } & AnswerProps) {
  if (questions.length === 0) {
    return null;
  }
  return (
    <ul className="line-questions">
      {questions.map((question) => (
        <QuestionItem key={question.invoiceReviewQuestionId} question={question} {...answer} />
      ))}
    </ul>
  );
}

// Under a line, after its questions: opens the form to ask about it.
export function AskLink({ askWhom, onAsk }: { askWhom: string; onAsk: () => void }) {
  return (
    <p className="line-ask">
      <button type="button" className="link-button" onClick={onAsk}>
        Ask {askWhom} about this line
      </button>
    </p>
  );
}

export function QuestionForm({
  invoiceLineId,
  lineNumber,
  saving,
  onAsk,
  onCancel,
  askWhom = 'the submitter',
}: {
  invoiceLineId: string;
  lineNumber: number | undefined;
  saving: boolean;
  onAsk: (input: { question: string; invoiceLineId: string }) => Promise<boolean>;
  onCancel: () => void;
  // Who answers: the person it is from, when staff entered it.
  askWhom?: string;
}) {
  const [question, setQuestion] = useState('');
  const title = `Ask ${askWhom} about line ${lineNumber ?? ''}`.trim();

  // One line: the question, Ask and Cancel, with who sees it underneath.
  return (
    <form
      className="question-form"
      aria-label={title}
      onSubmit={(event) => {
        event.preventDefault();
        void onAsk({ question, invoiceLineId });
      }}
    >
      <div className="question-form__row">
        <label className="usa-sr-only" htmlFor={`question-${invoiceLineId}`}>
          {title}
        </label>
        <input
          id={`question-${invoiceLineId}`}
          className="usa-input"
          placeholder={`${title}…`}
          maxLength={MAX_QUESTION_LENGTH}
          value={question}
          autoFocus
          onChange={(event) => setQuestion(event.target.value)}
        />
        <button type="submit" className="btn btn--primary" disabled={!question.trim() || saving}>Ask</button>
        <button type="button" className="link-button" onClick={onCancel}>Cancel</button>
      </div>
      <span className="cell-note">
        {askWhom.charAt(0).toUpperCase()}
        {askWhom.slice(1)} sees it. Review waits until it's answered.
      </span>
    </form>
  );
}

function AnswerForm({ staff, saving, onAnswer }: { staff: boolean; saving: boolean; onAnswer: (answer: string) => Promise<boolean> }) {
  const [open, setOpen] = useState(!staff);
  const [answer, setAnswer] = useState('');

  if (!open) {
    return (
      <button type="button" className="btn btn--outline btn--small" onClick={() => setOpen(true)}>
        Record their answer
      </button>
    );
  }
  return (
    <form
      className="line-question__answer"
      onSubmit={(event) => {
        event.preventDefault();
        void onAnswer(answer).then((saved) => saved && setAnswer(''));
      }}
    >
      <label className="decision-panel__question">
        {staff ? 'Their answer, by phone, email or in person' : 'Your answer'}
        <textarea rows={2} maxLength={MAX_QUESTION_LENGTH} value={answer} onChange={(event) => setAnswer(event.target.value)} />
        <span className="cell-note">
          {staff ? 'Recorded under your name. Review continues once every question is answered.' : 'The billing office sees it, and it stays on the invoice.'}
        </span>
      </label>
      <div className="button-row">
        <button type="submit" className="btn btn--primary" disabled={!answer.trim() || saving}>
          {staff ? 'Record answer' : 'Send answer'}
        </button>
        {staff && (
          <button type="button" className="link-button" onClick={() => setOpen(false)}>Cancel</button>
        )}
      </div>
    </form>
  );
}
