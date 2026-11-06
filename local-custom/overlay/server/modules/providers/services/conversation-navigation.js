// Lightweight conversation outline and bounded transcript windows. Native IDs,
// rather than timestamps or array positions, are the public navigation anchors.
export function navigationExcerpt(message, limit = 220) {
  let text = message.displayText || message.content || '';
  if (typeof text !== 'string') text = '';
  if (text.includes('<send_user_message_question_reply>')) {
    try {
      const body = text.split('<send_user_message_question_reply>')[1].split('</send_user_message_question_reply>')[0];
      text = JSON.parse(body).map(item => `${item.question || '问题'}：${item.answer || '已跳过'}`).join('；');
    } catch { text = '回答交互问题'; }
  }
  text = text.replace(/<environment_context>[\s\S]*?<\/environment_context>/g, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[图片]')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/[#*`>]/g, '').replace(/\s+/g, ' ').trim();
  if (!text) text = message.images?.length ? '[图片]' : message.files?.length ? '[附件]' : '消息';
  return text.length > limit ? text.slice(0, limit) + '…' : text;
}
export function buildConversationOutline(messages) {
  const entries = [], byId = new Map(), byTurn = new Map();
  for (const message of messages) {
    if (message.kind !== 'text' || message.role !== 'user' || message.parentToolUseId || !message.id) continue;
    const entry = {id: message.id, timestamp: message.timestamp, question: navigationExcerpt(message), answer: '', rowIds: [message.id]};
    entries.push(entry); byId.set(message.id, entry);
    if (message.turnId) byTurn.set(message.turnId, entry);
  }
  let current;
  for (const message of messages) {
    if (byId.has(message.id)) { current = byId.get(message.id); continue; }
    const explicit = message.parentUserMessageId || message.turnId;
    const owner = byId.get(message.parentUserMessageId) || byTurn.get(message.turnId) || (!explicit ? current : undefined);
    if (!owner || message.parentToolUseId) continue;
    if (message.id) owner.rowIds.push(message.id);
    if (message.kind === 'text' && message.role === 'assistant' && message.content?.trim()) owner.answer = navigationExcerpt(message, 300);
    if (message.kind === 'error' && !owner.answer) owner.answer = navigationExcerpt(message, 300);
  }
  return entries;
}
export function conversationWindow(messages, anchor, direction = 'around', count = 120) {
  const index = messages.findIndex(message => message.id === anchor);
  if (index < 0) return null;
  let start, end;
  if (direction === 'before') { end = index + 1; start = Math.max(0, end - count); }
  else if (direction === 'after') { start = index; end = Math.min(messages.length, start + count); }
  else { start = Math.max(0, index - 12); end = Math.min(messages.length, Math.max(index + 1, start + count)); }
  return {messages: messages.slice(start, end), total: messages.length, hasBefore: start > 0, hasAfter: end < messages.length,
    firstId: messages[start]?.id, lastId: messages[end - 1]?.id};
}
