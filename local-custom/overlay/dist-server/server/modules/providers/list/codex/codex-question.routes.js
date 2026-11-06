import express from 'express';
import { asyncHandler, AppError } from '../../../../shared/utils.js';
import { listCodexQuestions, submitCodexAnswers } from './codex-async-questions.js';

export const codexQuestionRouter = express.Router();
codexQuestionRouter.param('sessionId', (req, _res, next, value) => {
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(value)) {
    next(new AppError('Invalid sessionId.', { statusCode: 400, code: 'INVALID_SESSION_ID' }));
  } else next();
});
codexQuestionRouter.get('/codex/sessions/:sessionId/questions', asyncHandler(async (req, res) => {
  res.set('Cache-Control', 'no-store');
  res.json(await listCodexQuestions(req.params.sessionId));
}));
codexQuestionRouter.post('/codex/sessions/:sessionId/questions/:requestId/answers', asyncHandler(async (req, res) => {
  res.json(await submitCodexAnswers(req.params.sessionId, req.params.requestId, req.body?.answers));
}));
