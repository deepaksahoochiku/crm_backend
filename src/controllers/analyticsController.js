const Lead = require('../models/leadModel');
const Customer = require('../models/customerModel');
const Deal = require('../models/dealModel');
const Activity = require('../models/activityModel');
const User = require('../models/userModel');
const { ROLES, LEAD_STATUS, DEAL_STAGE, CUSTOMER_STATUS, ACTIVITY_STATUS } = require('../constants/enums');

const getUserScope = async (user) => {
  if (user.role === ROLES.ADMIN) {
    return {
      scopeType: 'Admin',
      assignedToFilter: {},
      teamUserIds: null
    };
  }

  if (user.role === ROLES.SALES_MANAGER) {
    const teamExecutives = await User.find({ manager: user._id }).select('_id');
    const teamUserIds = [user._id, ...teamExecutives.map((exec) => exec._id)];
    return {
      scopeType: 'Manager',
      assignedToFilter: { assignedTo: { $in: teamUserIds } },
      teamUserIds
    };
  }

  return {
    scopeType: 'Executive',
    assignedToFilter: { assignedTo: user._id },
    teamUserIds: [user._id]
  };
};

const getDateFilter = (startDate, endDate, fromDate, toDate, dateField = 'createdAt') => {
  const start = startDate || fromDate;
  const end = endDate || toDate;

  if (!start && !end) return {};

  const filter = {};
  filter[dateField] = {};

  if (start) {
    filter[dateField].$gte = new Date(start);
  }

  if (end) {
    const endDateTime = new Date(end);
    endDateTime.setHours(23, 59, 59, 999);
    filter[dateField].$lte = endDateTime;
  }

  return filter;
};

const getDashboardSummary = async (req, res, next) => {
  try {
    const { startDate, endDate, fromDate, toDate } = req.query;
    const scope = await getUserScope(req.user);
    const dateQuery = getDateFilter(startDate, endDate, fromDate, toDate, 'createdAt');

    const leadQuery = { ...scope.assignedToFilter, ...dateQuery };
    const customerQuery = { ...scope.assignedToFilter, ...dateQuery };
    const dealQuery = { ...scope.assignedToFilter, ...dateQuery };
    const activityQuery = { ...scope.assignedToFilter, ...dateQuery };

    const now = new Date();

    const [
      totalLeads,
      leadStatusAgg,
      leadSourceAgg,
      totalCustomers,
      activeCustomers,
      inactiveCustomers,
      totalDeals,
      dealStageAgg,
      totalActivities,
      completedActivities,
      pendingActivities,
      overdueActivities
    ] = await Promise.all([
      Lead.countDocuments(leadQuery),
      Lead.aggregate([
        { $match: leadQuery },
        { $group: { _id: '$status', count: { $sum: 1 } } }
      ]),
      Lead.aggregate([
        { $match: leadQuery },
        { $group: { _id: '$source', count: { $sum: 1 } } }
      ]),
      Customer.countDocuments(customerQuery),
      Customer.countDocuments({ ...customerQuery, status: CUSTOMER_STATUS.ACTIVE }),
      Customer.countDocuments({ ...customerQuery, status: CUSTOMER_STATUS.INACTIVE }),
      Deal.countDocuments(dealQuery),
      Deal.aggregate([
        { $match: dealQuery },
        {
          $group: {
            _id: '$stage',
            count: { $sum: 1 },
            totalValue: { $sum: '$dealValue' },
            expectedRevenue: { $sum: '$expectedRevenue' }
          }
        }
      ]),
      Activity.countDocuments(activityQuery),
      Activity.countDocuments({ ...activityQuery, status: ACTIVITY_STATUS.COMPLETED }),
      Activity.countDocuments({ ...activityQuery, status: ACTIVITY_STATUS.PENDING }),
      Activity.countDocuments({
        ...activityQuery,
        status: { $ne: ACTIVITY_STATUS.COMPLETED },
        dueDate: { $lt: now }
      })
    ]);

    const leadStatusMap = {};
    Object.values(LEAD_STATUS).forEach((st) => {
      leadStatusMap[st] = 0;
    });
    leadStatusAgg.forEach((item) => {
      if (item._id) leadStatusMap[item._id] = item.count;
    });

    const convertedLeads = leadStatusMap[LEAD_STATUS.CONVERTED] || 0;
    const leadConversionRate =
      totalLeads > 0 ? Number(((convertedLeads / totalLeads) * 100).toFixed(2)) : 0;

    const leadsBySource = {};
    leadSourceAgg.forEach((item) => {
      if (item._id) leadsBySource[item._id] = item.count;
    });

    const stageMap = {};
    Object.values(DEAL_STAGE).forEach((st) => {
      stageMap[st] = { count: 0, totalValue: 0, expectedRevenue: 0 };
    });
    dealStageAgg.forEach((item) => {
      if (item._id && stageMap[item._id]) {
        stageMap[item._id] = {
          count: item.count,
          totalValue: Math.round(item.totalValue),
          expectedRevenue: Math.round(item.expectedRevenue)
        };
      }
    });

    const pipelineStages = [DEAL_STAGE.DISCOVERY, DEAL_STAGE.PROPOSAL, DEAL_STAGE.NEGOTIATION];
    let openPipelineValue = 0;
    let openExpectedRevenue = 0;
    pipelineStages.forEach((st) => {
      if (stageMap[st]) {
        openPipelineValue += stageMap[st].totalValue;
        openExpectedRevenue += stageMap[st].expectedRevenue;
      }
    });

    const dealsWonCount = stageMap[DEAL_STAGE.WON] ? stageMap[DEAL_STAGE.WON].count : 0;
    const dealsWonValue = stageMap[DEAL_STAGE.WON] ? stageMap[DEAL_STAGE.WON].totalValue : 0;
    const dealsLostCount = stageMap[DEAL_STAGE.LOST] ? stageMap[DEAL_STAGE.LOST].count : 0;
    const dealsLostValue = stageMap[DEAL_STAGE.LOST] ? stageMap[DEAL_STAGE.LOST].totalValue : 0;

    const closedDealsTotal = dealsWonCount + dealsLostCount;
    const winRate =
      closedDealsTotal > 0 ? Number(((dealsWonCount / closedDealsTotal) * 100).toFixed(2)) : 0;

    let teamPerformance = null;
    if (req.user.role === ROLES.ADMIN || req.user.role === ROLES.SALES_MANAGER) {
      let targetExecutivesQuery = { role: ROLES.SALES_EXECUTIVE, isActive: true };
      if (req.user.role === ROLES.SALES_MANAGER) {
        targetExecutivesQuery.manager = req.user._id;
      }

      const teamExecutives = await User.find(targetExecutivesQuery)
        .select('name email role manager')
        .populate('manager', 'name email');

      teamPerformance = await Promise.all(
        teamExecutives.map(async (exec) => {
          const [execLeads, execWonDeals, execOpenDeals, execOverdue] = await Promise.all([
            Lead.countDocuments({ assignedTo: exec._id, ...dateQuery }),
            Deal.aggregate([
              { $match: { assignedTo: exec._id, stage: DEAL_STAGE.WON, ...dateQuery } },
              { $group: { _id: null, count: { $sum: 1 }, totalWon: { $sum: '$dealValue' } } }
            ]),
            Deal.aggregate([
              {
                $match: {
                  assignedTo: exec._id,
                  stage: { $in: pipelineStages },
                  ...dateQuery
                }
              },
              { $group: { _id: null, count: { $sum: 1 }, totalValue: { $sum: '$dealValue' } } }
            ]),
            Activity.countDocuments({
              assignedTo: exec._id,
              status: { $ne: ACTIVITY_STATUS.COMPLETED },
              dueDate: { $lt: now }
            })
          ]);

          const wonData = execWonDeals[0] || { count: 0, totalWon: 0 };
          const openData = execOpenDeals[0] || { count: 0, totalValue: 0 };

          return {
            executiveId: exec._id,
            name: exec.name,
            email: exec.email,
            manager: exec.manager ? exec.manager.name : 'Unassigned',
            totalLeads: execLeads,
            dealsWon: wonData.count,
            revenueWon: Math.round(wonData.totalWon),
            openDealsCount: openData.count,
            openPipelineValue: Math.round(openData.totalValue),
            overdueActivities: execOverdue
          };
        })
      );
    }

    res.status(200).json({
      success: true,
      message: 'Dashboard analytics summary retrieved successfully.',
      data: {
        roleScope: scope.scopeType,
        leads: {
          totalLeads,
          convertedLeads,
          conversionRate: `${leadConversionRate}%`,
          byStatus: leadStatusMap,
          bySource: leadsBySource
        },
        pipeline: {
          totalDeals,
          openPipelineValue,
          openExpectedRevenue,
          dealsWonCount,
          revenueWon: dealsWonValue,
          dealsLostCount,
          revenueLost: dealsLostValue,
          winRate: `${winRate}%`,
          stageBreakdown: stageMap
        },
        customers: {
          totalCustomers,
          activeCustomers,
          inactiveCustomers
        },
        activities: {
          totalActivities,
          pendingActivities,
          completedActivities,
          overdueActivities
        },
        teamPerformance
      }
    });
  } catch (error) {
    next(error);
  }
};

const getPipelineMetrics = async (req, res, next) => {
  try {
    const { startDate, endDate } = req.query;
    const scope = await getUserScope(req.user);
    const dateQuery = getDateFilter(startDate, endDate, null, null, 'createdAt');
    const dealQuery = { ...scope.assignedToFilter, ...dateQuery };

    const stageAgg = await Deal.aggregate([
      { $match: dealQuery },
      {
        $group: {
          _id: '$stage',
          dealCount: { $sum: 1 },
          totalValue: { $sum: '$dealValue' },
          expectedRevenue: { $sum: '$expectedRevenue' },
          avgDealValue: { $avg: '$dealValue' },
          avgProbability: { $avg: '$probability' }
        }
      }
    ]);

    const formattedStages = Object.values(DEAL_STAGE).map((stage) => {
      const found = stageAgg.find((item) => item._id === stage);
      return {
        stage,
        dealCount: found ? found.dealCount : 0,
        totalValue: found ? Math.round(found.totalValue) : 0,
        expectedRevenue: found ? Math.round(found.expectedRevenue) : 0,
        avgDealValue: found ? Math.round(found.avgDealValue) : 0,
        avgProbability: found ? Math.round(found.avgProbability) : 0
      };
    });

    res.status(200).json({
      success: true,
      message: 'Sales pipeline stage metrics retrieved successfully.',
      data: {
        roleScope: scope.scopeType,
        pipeline: formattedStages
      }
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  getDashboardSummary,
  getPipelineMetrics
};
