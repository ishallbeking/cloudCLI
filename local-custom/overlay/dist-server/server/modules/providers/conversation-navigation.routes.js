import express from 'express';
import { asyncHandler, AppError, createApiSuccessResponse } from '../../shared/utils.js';
import { sessionsService } from './services/sessions.service.js';
import { buildConversationOutline, conversationWindow } from './services/conversation-navigation.js';
export const conversationNavigationRouter = express.Router();
conversationNavigationRouter.get('/sessions/:sessionId/navigation', asyncHandler(async (req, res) => {
  const sessionId = req.params.sessionId;
  if (typeof sessionId !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(sessionId)) {
    throw new AppError('Invalid sessionId.', {code:'INVALID_SESSION_ID', statusCode:400});
  }
  const {anchor, direction = 'around'} = req.query;
  if ((anchor !== undefined && (typeof anchor !== 'string' || !anchor || anchor.length > 512)) ||
      !['around','before','after'].includes(direction)) {
    throw new AppError('Invalid navigation anchor or direction.', {code:'INVALID_NAVIGATION', statusCode:400});
  }
  const history = await sessionsService.fetchHistory(sessionId, {limit:null, offset:0});
  res.set('Cache-Control', 'no-store');
  if (anchor !== undefined) {
    const window = conversationWindow(history.messages, anchor, direction);
    if (!window) throw new AppError('This message is no longer in the transcript. Refresh the conversation outline.', {code:'NAVIGATION_ANCHOR_NOT_FOUND', statusCode:404});
    res.json(createApiSuccessResponse(window));
  } else res.json(createApiSuccessResponse({entries:buildConversationOutline(history.messages), total:history.total}));
}));
