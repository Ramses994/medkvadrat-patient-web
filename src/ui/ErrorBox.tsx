import { errorText, isRetryable } from '../api/errors';

type Props = {
  code?: string;
  status?: number;
  onRetry?: () => void;
};

export function ErrorBox({ code, status, onRetry }: Props) {
  const text = errorText(code, status);
  const retry = onRetry && isRetryable(code, status);
  return (
    <div className="error" role="alert">
      <div>{text}</div>
      {retry ? (
        <div className="stack-gap-sm">
          <button type="button" className="btn" onClick={onRetry}>
            Повторить
          </button>
        </div>
      ) : null}
    </div>
  );
}
