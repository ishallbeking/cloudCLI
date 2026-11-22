import express from 'express';
/**
 * Creates the Auth transport adapter. Handlers only parse request data and
 * delegate authentication behavior to the injected application service.
 */
export function createAuthRouter(service, authenticateToken) {
    const router = express.Router();
    router.get('/status', (_req, res, next) => {
        try {
            res.json(service.getStatus());
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/register', async (req, res, next) => {
        try {
            const body = (req.body ?? {});
            res.json(await service.register(body.username, body.password));
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/accounts', authenticateToken, async (req, res, next) => {
        try {
            const body = (req.body ?? {});
            res.status(201).json(await service.createAccount(body.username, body.password));
        }
        catch (error) {
            next(error);
        }
    });
    router.post('/login', async (req, res, next) => {
        try {
            const body = (req.body ?? {});
            res.json(await service.login(body.username, body.password));
        }
        catch (error) {
            next(error);
        }
    });
    router.get('/user', authenticateToken, (req, res) => {
        res.json(service.getCurrentUser(req.user));
    });
    router.post('/refresh', authenticateToken, (req, res) => {
        res.json(service.refreshSession(req.user));
    });
    router.post('/logout', authenticateToken, (_req, res) => {
        res.json(service.logout());
    });
    return router;
}
