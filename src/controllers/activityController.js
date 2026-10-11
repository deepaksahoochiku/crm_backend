const mongoose = require('mongoose');
const Activity = require('../models/activityModel');
const Lead = require('../models/leadModel');
const Customer = require('../models/customerModel');
const Deal = require('../models/dealModel');
const User = require('../models/userModel');
const Timeline = require('../models/timelineModel');
const { ROLES, ACTIVITY_TYPE, ACTIVITY_STATUS, ENTITY_TYPE } = require('../constants/enums');

const formatActivityWithOverdue = (activityDoc) => {
  const activity = activityDoc.toObject ? activityDoc.toObject() : { ...activityDoc };
  const now = new Date();
  const isOverdue =
    activity.status !== ACTIVITY_STATUS.COMPLETED &&
    activity.dueDate &&
    new Date(activity.dueDate) < now;

  return {
    ...activity,
    isOverdue: Boolean(isOverdue),
    effectiveStatus: isOverdue ? ACTIVITY_STATUS.OVERDUE : activity.status
  };
};

const getAssociatedEntityForTimeline = (activity) => {
  if (activity.lead) {
    return { entityType: ENTITY_TYPE.LEAD, entityId: activity.lead._id || activity.lead };
  }
  if (activity.deal) {
    return { entityType: ENTITY_TYPE.DEAL, entityId: activity.deal._id || activity.deal };
  }
  if (activity.customer) {
    return { entityType: ENTITY_TYPE.CUSTOMER, entityId: activity.customer._id || activity.customer };
  }
  return { entityType: ENTITY_TYPE.ACTIVITY, entityId: activity._id };
};

const createActivity = async (req, res, next) => {
  try {
    const {
      title,
      type,
      dueDate,
      lead: leadId,
      customer: customerId,
      deal: dealId,
      assignedTo,
      notes,
      status
    } = req.body;

    if (!title || !type) {
      return res.status(400).json({
        success: false,
        message: 'title and type are required fields.'
      });
    }

    const matchedType = Object.values(ACTIVITY_TYPE).find(
      (t) => t.toLowerCase() === type.trim().toLowerCase()
    );
    if (!matchedType) {
      return res.status(400).json({
        success: false,
        message: `Invalid activity type. Allowed types: ${Object.values(ACTIVITY_TYPE).join(', ')}`
      });
    }

    let parsedDueDate = null;
    if (matchedType !== ACTIVITY_TYPE.NOTE) {
      if (!dueDate) {
        return res.status(400).json({
          success: false,
          message: `dueDate is required for activity type '${matchedType}'.`
        });
      }
      parsedDueDate = new Date(dueDate);
      if (isNaN(parsedDueDate.getTime())) {
        return res.status(400).json({
          success: false,
          message: 'Invalid dueDate format. Please provide a valid date.'
        });
      }
    } else if (dueDate) {
      parsedDueDate = new Date(dueDate);
      if (isNaN(parsedDueDate.getTime())) parsedDueDate = null;
    }

    if (leadId) {
      if (!mongoose.Types.ObjectId.isValid(leadId)) {
        return res.status(400).json({ success: false, message: 'Invalid lead ID format.' });
      }
      const leadExists = await Lead.findById(leadId);
      if (!leadExists) {
        return res.status(404).json({ success: false, message: 'Associated lead not found.' });
      }
    }

    if (customerId) {
      if (!mongoose.Types.ObjectId.isValid(customerId)) {
        return res.status(400).json({ success: false, message: 'Invalid customer ID format.' });
      }
      const customerExists = await Customer.findById(customerId);
      if (!customerExists) {
        return res.status(404).json({ success: false, message: 'Associated customer not found.' });
      }
    }

    if (dealId) {
      if (!mongoose.Types.ObjectId.isValid(dealId)) {
        return res.status(400).json({ success: false, message: 'Invalid deal ID format.' });
      }
      const dealExists = await Deal.findById(dealId);
      if (!dealExists) {
        return res.status(404).json({ success: false, message: 'Associated deal not found.' });
      }
    }

    let finalAssignedTo = req.user._id;

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      finalAssignedTo = req.user._id;
    } else if (assignedTo) {
      if (!mongoose.Types.ObjectId.isValid(assignedTo)) {
        return res.status(400).json({
          success: false,
          message: 'Invalid assignedTo user ID format.'
        });
      }

      const targetUser = await User.findOne({ _id: assignedTo, isActive: true });
      if (!targetUser) {
        return res.status(404).json({
          success: false,
          message: 'Assigned user not found or inactive.'
        });
      }

      if (req.user.role === ROLES.SALES_MANAGER) {
        const isTeamMember =
          targetUser.manager && targetUser.manager.toString() === req.user._id.toString();
        const isSelf = targetUser._id.toString() === req.user._id.toString();

        if (!isTeamMember && !isSelf) {
          return res.status(403).json({
            success: false,
            message: 'You can only assign activities to executives in your team.'
          });
        }
      }

      finalAssignedTo = targetUser._id;
    }

    let initialStatus = ACTIVITY_STATUS.PENDING;
    if (status) {
      const matchedStatus = Object.values(ACTIVITY_STATUS).find(
        (s) => s.toLowerCase() === status.trim().toLowerCase()
      );
      if (matchedStatus) initialStatus = matchedStatus;
    }

    const activity = await Activity.create({
      title: title.trim(),
      type: matchedType,
      status: initialStatus,
      dueDate: parsedDueDate,
      lead: leadId || null,
      customer: customerId || null,
      deal: dealId || null,
      assignedTo: finalAssignedTo,
      notes: (notes || '').trim(),
      createdBy: req.user._id
    });

    const entityTarget = getAssociatedEntityForTimeline(activity);
    const actionName = matchedType === ACTIVITY_TYPE.NOTE ? 'Note added' : 'Follow-up created';

    await Timeline.create({
      action: actionName,
      entityType: entityTarget.entityType,
      entityId: entityTarget.entityId,
      performedBy: req.user._id,
      newValue: {
        activityId: activity._id,
        title: activity.title,
        type: activity.type,
        dueDate: activity.dueDate,
        assignedTo: activity.assignedTo
      },
      notes: `${actionName}: '${activity.title}' (${activity.type}).`
    });

    const populatedActivity = await Activity.findById(activity._id)
      .populate('lead', 'name status company')
      .populate('customer', 'name email company')
      .populate('deal', 'name dealValue stage')
      .populate('assignedTo', 'name email phone role')
      .populate('createdBy', 'name email role');

    res.status(201).json({
      success: true,
      message: `${matchedType} activity created successfully.`,
      data: {
        activity: formatActivityWithOverdue(populatedActivity)
      }
    });
  } catch (error) {
    next(error);
  }
};

const getActivities = async (req, res, next) => {
  try {
    const {
      search,
      keyword,
      q,
      type,
      status,
      isOverdue,
      lead: leadId,
      customer: customerId,
      deal: dealId,
      assignedTo,
      startDate,
      endDate,
      dueDateStart,
      dueDateEnd,
      page = 1,
      limit = 10,
      sortBy = 'dueDate',
      sortOrder = 'asc',
      sort
    } = req.query;

    const query = {};
    const now = new Date();

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      query.assignedTo = req.user._id;
    } else if (req.user.role === ROLES.SALES_MANAGER) {
      const teamExecutives = await User.find({ manager: req.user._id }).select('_id');
      const teamExecutiveIds = teamExecutives.map((exec) => exec._id);

      if (assignedTo) {
        query.assignedTo = assignedTo;
      } else {
        query.$or = [
          { assignedTo: { $in: teamExecutiveIds } },
          { assignedTo: req.user._id },
          { createdBy: req.user._id }
        ];
      }
    } else if (assignedTo) {
      query.assignedTo = assignedTo;
    }

    const searchTerm = (search || keyword || q || '').trim();
    if (searchTerm) {
      const searchRegex = { $regex: searchTerm, $options: 'i' };
      const searchConditions = [{ title: searchRegex }, { notes: searchRegex }];

      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchConditions }];
        delete query.$or;
      } else {
        query.$or = searchConditions;
      }
    }

    if (type) {
      const matchedType = Object.values(ACTIVITY_TYPE).find(
        (t) => t.toLowerCase() === type.trim().toLowerCase()
      );
      if (matchedType) query.type = matchedType;
    }

    if (status) {
      const cleanStatus = status.trim().toLowerCase();
      if (cleanStatus === 'overdue') {
        query.status = { $ne: ACTIVITY_STATUS.COMPLETED };
        query.dueDate = { $lt: now };
      } else if (cleanStatus === 'pending') {
        query.status = ACTIVITY_STATUS.PENDING;
      } else if (cleanStatus === 'completed') {
        query.status = ACTIVITY_STATUS.COMPLETED;
      }
    }

    if (String(isOverdue).toLowerCase() === 'true') {
      query.status = { $ne: ACTIVITY_STATUS.COMPLETED };
      query.dueDate = { $lt: now };
    } else if (String(isOverdue).toLowerCase() === 'false') {
      query.$or = [{ status: ACTIVITY_STATUS.COMPLETED }, { dueDate: { $gte: now } }];
    }

    if (leadId && mongoose.Types.ObjectId.isValid(leadId)) {
      query.lead = leadId;
    }
    if (customerId && mongoose.Types.ObjectId.isValid(customerId)) {
      query.customer = customerId;
    }
    if (dealId && mongoose.Types.ObjectId.isValid(dealId)) {
      query.deal = dealId;
    }

    const start = dueDateStart || startDate;
    const end = dueDateEnd || endDate;
    if (start || end) {
      if (!query.dueDate) query.dueDate = {};
      if (start) query.dueDate.$gte = new Date(start);
      if (end) {
        const endDateTime = new Date(end);
        endDateTime.setHours(23, 59, 59, 999);
        query.dueDate.$lte = endDateTime;
      }
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 10));
    const skip = (pageNum - 1) * limitNum;

    let sortOption = {};
    if (sort) {
      if (sort.includes(':')) {
        const [field, order] = sort.split(':');
        sortOption[field] = order.toLowerCase() === 'asc' ? 1 : -1;
      } else if (sort.startsWith('-')) {
        sortOption[sort.substring(1)] = -1;
      } else {
        sortOption[sort] = 1;
      }
    } else {
      const direction = String(sortOrder).toLowerCase() === 'desc' ? -1 : 1;
      sortOption[sortBy] = direction;
    }

    const [activities, totalActivities, overdueCount, pendingCount, completedCount] =
      await Promise.all([
        Activity.find(query)
          .populate('lead', 'name company status')
          .populate('customer', 'name company')
          .populate('deal', 'name dealValue stage')
          .populate('assignedTo', 'name email role phone')
          .populate('createdBy', 'name email role')
          .sort(sortOption)
          .skip(skip)
          .limit(limitNum),
        Activity.countDocuments(query),
        Activity.countDocuments({
          ...query,
          status: { $ne: ACTIVITY_STATUS.COMPLETED },
          dueDate: { $lt: now }
        }),
        Activity.countDocuments({ ...query, status: ACTIVITY_STATUS.PENDING }),
        Activity.countDocuments({ ...query, status: ACTIVITY_STATUS.COMPLETED })
      ]);

    const formattedActivities = activities.map(formatActivityWithOverdue);
    const totalPages = Math.ceil(totalActivities / limitNum) || 1;

    res.status(200).json({
      success: true,
      message: 'Activities fetched successfully.',
      data: {
        activities: formattedActivities,
        summary: {
          totalActivities,
          pendingCount,
          completedCount,
          overdueCount
        },
        pagination: {
          currentPage: pageNum,
          pageSize: limitNum,
          totalRecords: totalActivities,
          totalPages,
          hasNextPage: pageNum < totalPages,
          hasPrevPage: pageNum > 1
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

const getActivityById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid activity ID format.'
      });
    }

    const activity = await Activity.findById(id)
      .populate('lead', 'name email phone company status source')
      .populate('customer', 'name email phone company address')
      .populate('deal', 'name dealValue expectedRevenue stage')
      .populate('assignedTo', 'name email role phone')
      .populate('createdBy', 'name email role');

    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      const assignedId = activity.assignedTo ? activity.assignedTo._id.toString() : null;
      if (assignedId !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view activities assigned to you.'
        });
      }
    } else if (req.user.role === ROLES.SALES_MANAGER) {
      const teamExecutives = await User.find({ manager: req.user._id }).select('_id');
      const teamExecutiveIds = teamExecutives.map((exec) => exec._id.toString());
      const assignedId = activity.assignedTo ? activity.assignedTo._id.toString() : null;
      const createdById = activity.createdBy ? activity.createdBy._id.toString() : null;

      const isAssignedToTeam = assignedId && teamExecutiveIds.includes(assignedId);
      const isAssignedToSelf = assignedId === req.user._id.toString();
      const isCreatedBySelf = createdById === req.user._id.toString();

      if (!isAssignedToTeam && !isAssignedToSelf && !isCreatedBySelf) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view activities within your team.'
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Activity details retrieved successfully.',
      data: {
        activity: formatActivityWithOverdue(activity)
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateActivity = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid activity ID format.'
      });
    }

    const activity = await Activity.findById(id);
    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      if (activity.assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only update activities assigned to you.'
        });
      }
    } else if (req.user.role === ROLES.SALES_MANAGER) {
      const teamExecutives = await User.find({ manager: req.user._id }).select('_id');
      const teamExecutiveIds = teamExecutives.map((exec) => exec._id.toString());
      const assignedId = activity.assignedTo.toString();
      const createdById = activity.createdBy.toString();

      const isAssignedToTeam = teamExecutiveIds.includes(assignedId);
      const isAssignedToSelf = assignedId === req.user._id.toString();
      const isCreatedBySelf = createdById === req.user._id.toString();

      if (!isAssignedToTeam && !isAssignedToSelf && !isCreatedBySelf) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only update activities within your team.'
        });
      }
    }

    const { title, type, dueDate, notes, status, assignedTo, lead, customer, deal } = req.body;

    if (title) activity.title = title.trim();
    if (notes !== undefined) activity.notes = notes.trim();

    if (type) {
      const matchedType = Object.values(ACTIVITY_TYPE).find(
        (t) => t.toLowerCase() === type.trim().toLowerCase()
      );
      if (matchedType) activity.type = matchedType;
    }

    if (dueDate) {
      const parsedDate = new Date(dueDate);
      if (!isNaN(parsedDate.getTime())) {
        activity.dueDate = parsedDate;
      }
    }

    if (status) {
      const matchedStatus = Object.values(ACTIVITY_STATUS).find(
        (s) => s.toLowerCase() === status.trim().toLowerCase()
      );
      if (matchedStatus) {
        activity.status = matchedStatus;
        if (matchedStatus === ACTIVITY_STATUS.COMPLETED && !activity.completedAt) {
          activity.completedAt = new Date();
        }
      }
    }

    if (assignedTo && req.user.role !== ROLES.SALES_EXECUTIVE) {
      if (mongoose.Types.ObjectId.isValid(assignedTo)) {
        const targetUser = await User.findOne({ _id: assignedTo, isActive: true });
        if (targetUser) {
          if (req.user.role === ROLES.SALES_MANAGER) {
            const isTeam =
              targetUser.manager && targetUser.manager.toString() === req.user._id.toString();
            const isSelf = targetUser._id.toString() === req.user._id.toString();
            if (isTeam || isSelf) activity.assignedTo = targetUser._id;
          } else {
            activity.assignedTo = targetUser._id;
          }
        }
      }
    }

    if (lead !== undefined) activity.lead = lead || null;
    if (customer !== undefined) activity.customer = customer || null;
    if (deal !== undefined) activity.deal = deal || null;

    await activity.save();

    const updatedActivity = await Activity.findById(activity._id)
      .populate('lead', 'name company status')
      .populate('customer', 'name company')
      .populate('deal', 'name dealValue stage')
      .populate('assignedTo', 'name email role phone')
      .populate('createdBy', 'name email role');

    res.status(200).json({
      success: true,
      message: 'Activity updated successfully.',
      data: {
        activity: formatActivityWithOverdue(updatedActivity)
      }
    });
  } catch (error) {
    next(error);
  }
};

const completeActivity = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid activity ID format.'
      });
    }

    const activity = await Activity.findById(id);
    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      if (activity.assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only complete activities assigned to you.'
        });
      }
    } else if (req.user.role === ROLES.SALES_MANAGER) {
      const teamExecutives = await User.find({ manager: req.user._id }).select('_id');
      const teamExecutiveIds = teamExecutives.map((exec) => exec._id.toString());
      const assignedId = activity.assignedTo.toString();
      const createdById = activity.createdBy.toString();

      const isAssignedToTeam = teamExecutiveIds.includes(assignedId);
      const isAssignedToSelf = assignedId === req.user._id.toString();
      const isCreatedBySelf = createdById === req.user._id.toString();

      if (!isAssignedToTeam && !isAssignedToSelf && !isCreatedBySelf) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only complete activities within your team.'
        });
      }
    }

    activity.status = ACTIVITY_STATUS.COMPLETED;
    activity.completedAt = new Date();
    await activity.save();

    const entityTarget = getAssociatedEntityForTimeline(activity);

    await Timeline.create({
      action: 'Follow-up completed',
      entityType: entityTarget.entityType,
      entityId: entityTarget.entityId,
      performedBy: req.user._id,
      previousValue: ACTIVITY_STATUS.PENDING,
      newValue: ACTIVITY_STATUS.COMPLETED,
      notes: `Activity completed: '${activity.title}' (${activity.type}).`
    });

    const populatedActivity = await Activity.findById(activity._id)
      .populate('lead', 'name company status')
      .populate('customer', 'name company')
      .populate('deal', 'name dealValue stage')
      .populate('assignedTo', 'name email role phone')
      .populate('createdBy', 'name email role');

    res.status(200).json({
      success: true,
      message: 'Activity marked as completed successfully.',
      data: {
        activity: formatActivityWithOverdue(populatedActivity)
      }
    });
  } catch (error) {
    next(error);
  }
};

const deleteActivity = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid activity ID format.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied. Sales Executives are not permitted to delete activities.'
      });
    }

    const activity = await Activity.findById(id);
    if (!activity) {
      return res.status(404).json({
        success: false,
        message: 'Activity not found.'
      });
    }

    if (req.user.role === ROLES.SALES_MANAGER) {
      const teamExecutives = await User.find({ manager: req.user._id }).select('_id');
      const teamExecutiveIds = teamExecutives.map((exec) => exec._id.toString());
      const assignedId = activity.assignedTo.toString();
      const createdById = activity.createdBy.toString();

      const isAssignedToTeam = teamExecutiveIds.includes(assignedId);
      const isAssignedToSelf = assignedId === req.user._id.toString();
      const isCreatedBySelf = createdById === req.user._id.toString();

      if (!isAssignedToTeam && !isAssignedToSelf && !isCreatedBySelf) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only delete activities within your team.'
        });
      }
    }

    await Activity.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: 'Activity deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createActivity,
  getActivities,
  getActivityById,
  updateActivity,
  completeActivity,
  deleteActivity
};
