import { Router } from 'express';
import { getIntel } from '../intel/service';

// Public read-only feed of the current intel buffer. No auth: it carries only
// already-public OSINT (news, dispatch, open crime data, social posts), same as
// the other live-data layers.
const router = Router();

router.get('/', (_req, res) => {
  res.json(getIntel());
});

export default router;
