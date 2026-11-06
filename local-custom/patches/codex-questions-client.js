// Injected into the upstream bundle by file-tree-lazy-client.mjs.
// f = upstream React, s = JSX runtime; ht/ft retain its authentication handling.
function CloudcliCodexQuestionCard({sessionId, request, onSubmitted}) {
  const storageKey = `cloudcli:codex-answers:${sessionId}:${request.id}`;
  const [draft, setDraft] = f.useState(() => {
    try { return JSON.parse(sessionStorage.getItem(storageKey)) || {}; } catch { return {}; }
  });
  const [busy, setBusy] = f.useState(false);
  const [error, setError] = f.useState('');
  const answered = request.status === 'answered';
  const edit = (id, patch) => setDraft(previous => {
    const next = {...previous, [id]: {...previous[id], ...patch}};
    try { sessionStorage.setItem(storageKey, JSON.stringify(next)); } catch { /* Optional draft persistence. */ }
    return next;
  });
  const answerFor = question => {
    const value = draft[question.id];
    return typeof value?.option === 'number' ? question.options[value.option] || '' : value?.text?.trim() || '';
  };
  const submit = async (skip = false) => {
    if (busy || answered) return;
    setBusy(true); setError('');
    try {
      const response = await ft(`/api/providers/codex/sessions/${encodeURIComponent(sessionId)}/questions/${encodeURIComponent(request.id)}/answers`, {
        answers: request.questions.map(question => ({questionItemId: question.id, answer: skip ? '用户跳过了此问题，请继续。' : answerFor(question)})),
      });
      const result = await response.json();
      if (!response.ok || result.delivered !== true) throw new Error(result.error?.message || result.error || result.message || '答案未送达，请重试。');
      try { sessionStorage.removeItem(storageKey); } catch {}
      onSubmitted(request.id);
    } catch (failure) { setError(failure.message || '提交失败，请重试。'); }
    finally { setBusy(false); }
  };
  if (answered) return null;
  const questionFields = request.questions.map((question, index) => s.jsxs('fieldset', {
    disabled: busy, style: {border: 0, margin: '0 0 14px', padding: 0},
    'data-question-id': question.id,
    children: [
      s.jsx('legend', {style: {fontWeight: 600, marginBottom: 9, whiteSpace: 'pre-wrap'}, children: `${index + 1}. ${question.title}`}),
      s.jsxs(f.Fragment, {children: [
          s.jsx('div', {style: {display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 8}, children: question.options.map((option, optionIndex) => {
            const selected = draft[question.id]?.option === optionIndex;
            return s.jsxs('label', {style: {display: 'flex', alignItems: 'center', gap: 7, cursor: 'pointer', padding: '7px 12px', borderRadius: 10,
              border: selected ? '1px solid #3b82f6' : '1px solid hsl(var(--border, 214 32% 91%))', background: selected ? 'rgba(59,130,246,.12)' : 'transparent'},
              children: [s.jsx('input', {type: 'radio', name: question.id, checked: selected,
                onChange: () => edit(question.id, {option: optionIndex, text: ''})}), option]}, optionIndex);
          })}),
          s.jsx('textarea', {'aria-label': `问题 ${index + 1} 的自由文本回答`, placeholder: '或输入自己的回答…', rows: 2,
            value: draft[question.id]?.text || '',
            onChange: event => edit(question.id, {option: null, text: event.target.value}),
            style: {width: '100%', resize: 'vertical', borderRadius: 9, padding: '8px 10px', color: 'inherit', background: 'transparent', border: '1px solid hsl(var(--border, 214 32% 91%))'}}),
        ]}),
    ],
  }, question.id));
  const body = s.jsxs('div', {style: {paddingTop: 12}, children: [
    s.jsx('div', {style: {maxHeight: '28vh', overflowY: 'auto', paddingRight: 4}, children: questionFields}),
    error && s.jsx('p', {role: 'alert', style: {color: '#dc2626', marginBottom: 8}, children: error}),
    s.jsxs('div', {style: {display: 'flex', alignItems: 'center', gap: 10}, children: [
      s.jsx('button', {type: 'button', onClick: () => submit(),
        disabled: busy || request.questions.some(question => !answerFor(question)),
        className: 'rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50',
        children: busy ? '正在提交…' : '提交答案'}),
      s.jsx('button', {type: 'button', onClick: () => submit(true), disabled: busy,
        title: '跳过本卡片中的全部问题，并通知 Codex 继续',
        className: 'rounded-lg border border-border px-4 py-2 text-sm font-medium hover:bg-muted disabled:opacity-50',
        children: '跳过'}),
    ]}),
  ]});
  return s.jsxs('section', {className: 'cloudcli-codex-question', 'data-request-id': request.id, 'aria-label': 'Codex 等待你的回答',
      style: {padding: 16, borderRadius: 14, border: '1px solid rgba(59,130,246,.45)', marginBottom: 10, background: 'hsl(var(--background, 0 0% 100%))', fontSize: 14},
      children: [s.jsx('p', {style: {fontWeight: 600, margin: 0}, children: 'Codex 等待你的回答'}),
        request.questions.length > 1 && s.jsx('p', {style: {fontSize: 12, opacity: .65, margin: '3px 0 0'}, children: `共 ${request.questions.length} 个问题，可滚动查看并逐题回答。`}), body]});
}

function CloudcliCodexQuestions({sessionId, provider, active, onUpdate}) {
  const [requests, setRequests] = f.useState([]);
  const [error, setError] = f.useState('');
  const updateRef = f.useRef(onUpdate);
  const refreshRef = f.useRef(null);
  const submittedRef = f.useRef(new Set());
  updateRef.current = onUpdate;
  f.useEffect(() => {
    if (!active || provider !== 'codex' || !sessionId) return;
    const controller = new AbortController();
    let timer, revision, sequence = 0;
    const refresh = async () => {
      const attempt = ++sequence;
      clearTimeout(timer);
      try {
        const response = await ht(`/api/providers/codex/sessions/${encodeURIComponent(sessionId)}/questions`, {signal: controller.signal});
        if (response.status === 404) return;
        const result = await response.json();
        if (!response.ok) throw new Error(result.error?.message || result.message || '问题加载失败');
        if (controller.signal.aborted || attempt !== sequence) return;
        setRequests(result.requests.filter(request => request.status === 'pending'
          && !submittedRef.current.has(`${sessionId}:${request.id}`))); setError('');
        if (revision && revision !== result.revision && result.requests.length) updateRef.current?.(sessionId);
        revision = result.revision;
      } catch (failure) { if (!controller.signal.aborted && attempt === sequence) setError(failure.message); }
      finally { if (!controller.signal.aborted && attempt === sequence) timer = setTimeout(refresh, 2000); }
    };
    refreshRef.current = refresh;
    refresh();
    return () => {controller.abort(); clearTimeout(timer); refreshRef.current = null;};
  }, [sessionId, provider, active]);
  if (!active || provider !== 'codex' || !sessionId) return null;
  return s.jsxs('div', {'data-codex-questions-session': sessionId, className: 'mx-auto w-full max-w-[54.25rem] px-2 sm:px-4',
    style: {maxHeight: '45vh', overflowY: 'auto', flexShrink: 0},
    children: [error && s.jsx('p', {role: 'alert', style: {fontSize: 12, color: '#dc2626'}, children: `Codex 问题加载失败：${error}`}),
      ...requests.map(request => s.jsx(CloudcliCodexQuestionCard, {sessionId, request, onSubmitted: id => {
        submittedRef.current.add(`${sessionId}:${id}`);
        setRequests(previous => previous.filter(item => item.id !== id));
        updateRef.current?.(sessionId);
        refreshRef.current?.();
      }}, request.id)),
    ]});
}
