import express from 'express';
import { AppError } from './../../shared/index.js';
import { sessionGroupsService } from './services/session-groups.service.js';
function userId(req) {
    const id = Number(req.user?.id);
    if (!Number.isSafeInteger(id) || id < 1)
        throw new AppError('请先登录。', { code: 'AUTH_REQUIRED', statusCode: 401 });
    return id;
}
function id(value) {
    if (typeof value !== 'string' || !/^[a-zA-Z0-9._-]{1,120}$/.test(value)) {
        throw new AppError('无效的标识。', { code: 'INVALID_GROUP_ID', statusCode: 400 });
    }
    return value;
}
function name(value) {
    if (typeof value !== 'string' || !value.trim() || value.trim().length > 100) {
        throw new AppError('组名称需为 1–100 个字符。', { code: 'INVALID_GROUP_NAME', statusCode: 400 });
    }
    return value.trim();
}
function sessionIds(value) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 100) {
        throw new AppError('每次请选择 1–100 条对话。', { code: 'INVALID_GROUP_SESSIONS', statusCode: 400 });
    }
    return [...new Set(value.map(id))];
}
function offset(value) {
    if (value === undefined)
        return 0;
    if (typeof value !== 'string' || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new AppError('无效的分页参数。', { code: 'INVALID_GROUP_PAGE', statusCode: 400 });
    }
    return Number(value);
}
/** Used by provider.routes to expose authenticated, user-scoped group operations. */
export function createSessionGroupsRouter(service = sessionGroupsService) {
    const router = express.Router();
    // Synchronous services let Express forward thrown AppErrors to the normal handler.
    router.get('/session-groups', (req, res) => res.json({ success: true, data: service.list(userId(req)) }));
    router.post('/session-groups', (req, res) => res.status(201).json({ success: true, data: service.create(userId(req), name(req.body?.name)) }));
    router.get('/session-groups/candidates', (req, res) => {
        userId(req);
        const query = req.query.q ?? '';
        if (typeof query !== 'string' || query.length > 200)
            throw new AppError('搜索内容过长。', { code: 'INVALID_GROUP_QUERY', statusCode: 400 });
        res.json({ success: true, data: service.candidates(query.trim(), 50, offset(req.query.offset)) });
    });
    router.patch('/session-groups/:groupId', (req, res) => res.json({ success: true, data: service.rename(userId(req), id(req.params.groupId), name(req.body?.name)) }));
    router.delete('/session-groups/:groupId', (req, res) => res.json({ success: true, data: service.remove(userId(req), id(req.params.groupId)) }));
    router.post('/session-groups/:groupId/sessions', (req, res) => res.json({ success: true, data: service.add(userId(req), id(req.params.groupId), sessionIds(req.body?.sessionIds)) }));
    router.delete('/session-groups/:groupId/sessions/:sessionId', (req, res) => res.json({ success: true, data: service.removeMember(userId(req), id(req.params.groupId), id(req.params.sessionId)) }));
    return router;
}
