const express = require('express');
const path = require('path');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const { prisma } = require('./lib/prisma');
const { ALLOWED_PLATFORMS, runPost, startScheduler } = require('./lib/postingEngine');

const app = express();
const PORT = process.env.PORT || 3000;

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, '..', 'views'));

app.use(express.urlencoded({ extended: true }));
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

  const posts = await prisma.post.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
  });

  const logs = await prisma.postLog.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: 'desc' },
    take: 20,
  });

  res.render('dashboard', {
    flash: popFlash(req),
    user,
    posts,
    logs,
    platforms: ALLOWED_PLATFORMS,
    nowIsoLocal: new Date(Date.now() - new Date().getTimezoneOffset() * 60000).toISOString().slice(0, 16),
  });
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
