const express = require('express');

const authRoutes = require('./routes/authRoutes');
const leadRoutes = require('./routes/leadRoutes');
const customerRoutes = require('./routes/customerRoutes');
const dealRoutes = require('./routes/dealRoutes');
const timelineRoutes = require('./routes/timelineRoutes');
const analyticsRoutes = require('./routes/analyticsRoutes');
const activityRoutes = require('./routes/activityRoutes');

const router = express.Router();

router.use('/auth', authRoutes);
router.use('/leads', leadRoutes);
router.use('/customers', customerRoutes);
router.use('/deals', dealRoutes);
router.use('/timeline', timelineRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/dashboard', analyticsRoutes);
router.use('/activities', activityRoutes);

module.exports = router;
