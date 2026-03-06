const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const { prisma } = require('./lib/prisma');
const { ALLOWED_PLATFORMS, runPost, startScheduler } = require('./lib/postingEngine');
const { generateRecommendation } = require('./lib/aiSuggest');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'change-me-in-production',
    resave: false,
    saveUninitialized: false,
  })
);

function setFlash(req, message) {
  req.session.flash = message;
}

function popFlash(req) {
  const msg = req.session.flash;
  delete req.session.flash;
  return msg;
}

function requireAuth(req, res, next) {
  if (!req.session.userId) {
    return res.redirect('/login');
  }
  return next();
}

async function currentUser(req) {
  if (!req.session.userId) return null;
  return prisma.user.findUnique({ where: { id: req.session.userId } });
}

function wrap(handler) {
  return async (req, res, next) => {
    try {
      await handler(req, res, next);
    } catch (err) {
      next(err);
    }
  };
}

app.get('/', (req, res) => {
  if (req.session.userId) {
    return res.redirect('/dashboard');
  }
  return res.redirect('/login');
});

app.get('/signup', (req, res) => {
  res.render('signup', { flash: popFlash(req) });
});

app.post('/signup', wrap(async (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password || !name) {
    setFlash(req, 'Name, email, and password are required.');
    return res.redirect('/signup');
  }

  const existing = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (existing) {
    setFlash(req, 'Email already exists. Log in instead.');
    return res.redirect('/login');
  }

  const passwordHash = await bcrypt.hash(password, 10);

  await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      name,
      passwordHash,
    },
  });

  setFlash(req, 'Account created. Please log in.');
  return res.redirect('/login');
}));

app.get('/login', (req, res) => {
  res.render('login', { flash: popFlash(req) });
});

app.post('/login', wrap(async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    setFlash(req, 'Email and password are required.');
    return res.redirect('/login');
  }

  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    setFlash(req, 'Invalid email or password.');
    return res.redirect('/login');
  }

  const ok = await bcrypt.compare(password, user.passwordHash);
  if (!ok) {
    setFlash(req, 'Invalid email or password.');
    return res.redirect('/login');
  }

  req.session.userId = user.id;
  return res.redirect('/dashboard');
}));

app.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

app.get('/dashboard', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    req.session.userId = null;
    return res.redirect('/login');
  }

  const [posts, logs, savedConnections] = await Promise.all([
    prisma.post.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.postLog.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
    }),
    prisma.platformConnection.findMany({
      where: { userId: user.id },
      orderBy: { platform: 'asc' },
    }),
  ]);

  const connections = ALLOWED_PLATFORMS.map((platform) => {
    const conn = savedConnections.find((c) => c.platform === platform);
    return conn || {
      platform,
      status: 'disconnected',
      accountLabel: '',
      scopes: '',
      expiresAt: null,
      connectedAt: null,
    };
  });

  res.render('dashboard', {
    flash: popFlash(req),
    user,
    posts,
    logs,
    platforms: ALLOWED_PLATFORMS,
    connections,
    nowIsoLocal: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
  });
}));

app.post('/api/ai/recommend', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const { topic, audience, goal, tone, platform } = req.body || {};
  if (!topic || !String(topic).trim()) {
    return res.status(400).json({ error: 'Topic is required.' });
  }

  const recommendation = await generateRecommendation({
    topic: String(topic).trim(),
    audience: audience ? String(audience).trim() : '',
    goal: goal ? String(goal).trim() : '',
    tone: tone ? String(tone).trim() : '',
    platform: platform ? String(platform).trim() : '',
  });

  return res.json(recommendation);
}));

app.post('/connections/:platform/connect', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    req.session.userId = null;
    return res.redirect('/login');
  }

  const platform = String(req.params.platform || '').toLowerCase();
  if (!ALLOWED_PLATFORMS.includes(platform)) {
    setFlash(req, 'Unsupported platform.');
    return res.redirect('/dashboard');
  }

  const { accountLabel, accessToken, refreshToken, scopes, expiresAt } = req.body;
  if (!accessToken || !String(accessToken).trim()) {
    setFlash(req, `Access token is required to connect ${platform}.`);
    return res.redirect('/dashboard');
  }

  let expiresAtDate = null;
  if (expiresAt) {
    const dt = new Date(expiresAt);
    if (Number.isNaN(dt.getTime())) {
      setFlash(req, 'Invalid expiry date/time.');
      return res.redirect('/dashboard');
    }
    expiresAtDate = dt;
  }

  await prisma.platformConnection.upsert({
    where: {
      userId_platform: {
        userId: user.id,
        platform,
      },
    },
    create: {
      userId: user.id,
      platform,
      accountLabel: accountLabel || null,
      accessToken: accessToken.trim(),
      refreshToken: refreshToken ? refreshToken.trim() : null,
      scopes: scopes || null,
      expiresAt: expiresAtDate,
      status: 'connected',
      connectedAt: new Date(),
    },
    update: {
      accountLabel: accountLabel || null,
      accessToken: accessToken.trim(),
      refreshToken: refreshToken ? refreshToken.trim() : null,
      scopes: scopes || null,
      expiresAt: expiresAtDate,
      status: 'connected',
      connectedAt: new Date(),
    },
  });

  setFlash(req, `${platform} authentication saved.`);
  return res.redirect('/dashboard');
}));

app.post('/connections/:platform/disconnect', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    req.session.userId = null;
    return res.redirect('/login');
  }

  const platform = String(req.params.platform || '').toLowerCase();
  if (!ALLOWED_PLATFORMS.includes(platform)) {
    setFlash(req, 'Unsupported platform.');
    return res.redirect('/dashboard');
  }

  await prisma.platformConnection.upsert({
    where: {
      userId_platform: {
        userId: user.id,
        platform,
      },
    },
    create: {
      userId: user.id,
      platform,
      status: 'disconnected',
      connectedAt: null,
      accountLabel: null,
      accessToken: null,
      refreshToken: null,
      scopes: null,
      expiresAt: null,
    },
    update: {
      status: 'disconnected',
      connectedAt: null,
      accountLabel: null,
      accessToken: null,
      refreshToken: null,
      scopes: null,
      expiresAt: null,
    },
  });

  setFlash(req, `${platform} disconnected.`);
  return res.redirect('/dashboard');
}));

app.post('/posts', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    req.session.userId = null;
    return res.redirect('/login');
  }

  const { title, caption, scheduledAt } = req.body;
  const selected = Array.isArray(req.body.platforms)
    ? req.body.platforms
    : req.body.platforms
      ? [req.body.platforms]
      : [];

  if (!title || !caption) {
    setFlash(req, 'Title and caption are required.');
    return res.redirect('/dashboard');
  }

  const validPlatforms = selected.filter((p) => ALLOWED_PLATFORMS.includes(p));
  if (validPlatforms.length === 0) {
    setFlash(req, 'Select at least one platform.');
    return res.redirect('/dashboard');
  }

  let status = 'draft';
  let scheduledAtIso = null;

  if (scheduledAt) {
    const dt = new Date(scheduledAt);
    if (Number.isNaN(dt.getTime())) {
      setFlash(req, 'Invalid schedule date/time.');
      return res.redirect('/dashboard');
    }
    status = 'scheduled';
    scheduledAtIso = dt;
  }

  await prisma.post.create({
    data: {
      userId: user.id,
      title,
      caption,
      platforms: validPlatforms,
      status,
      scheduledAt: scheduledAtIso,
    },
  });

  setFlash(req, 'Post created successfully.');
  return res.redirect('/dashboard');
}));

app.post('/posts/:id/run', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    req.session.userId = null;
    return res.redirect('/login');
  }

  const postId = req.params.id;
  const post = await prisma.post.findFirst({ where: { id: postId, userId: user.id } });
  if (!post) {
    setFlash(req, 'Post not found.');
    return res.redirect('/dashboard');
  }

  const result = await runPost(postId, user.email);
  if (!result.ok) {
    if (result.missingPlatforms && result.missingPlatforms.length > 0) {
      await prisma.post.update({ where: { id: postId }, data: { status: 'failed' } });
      await prisma.postLog.createMany({
        data: result.missingPlatforms.map((platform) => ({
          postId,
          userId: user.id,
          platform,
          message: 'Manual run failed: platform not authenticated',
          actor: user.email,
        })),
      });
    }
    setFlash(req, result.reason);
  } else {
    setFlash(req, 'Post ran successfully (simulated publishing).');
  }

  return res.redirect('/dashboard');
}));

app.post('/posts/:id/delete', requireAuth, wrap(async (req, res) => {
  const user = await currentUser(req);
  if (!user) {
    req.session.userId = null;
    return res.redirect('/login');
  }

  const postId = req.params.id;
  await prisma.post.deleteMany({ where: { id: postId, userId: user.id } });

  setFlash(req, 'Post deleted.');
  return res.redirect('/dashboard');
}));

app.use((err, req, res, next) => {
  // eslint-disable-next-line no-console
  console.error(err);
  if (req.path.startsWith('/api/')) {
    return res.status(500).json({ error: 'Server error. Please try again.' });
  }
  setFlash(req, 'Server error. Please try again.');
  if (res.headersSent) return next(err);
  return res.redirect('/login');
});

startScheduler();

app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`DailyVideoOps web app running at http://localhost:${PORT}`);
});

process.on('SIGINT', async () => {
  await prisma.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await prisma.$disconnect();
  process.exit(0);
});
