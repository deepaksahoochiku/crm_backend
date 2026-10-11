const mongoose = require('mongoose');
const Timeline = require('../models/timelineModel');
const Lead = require('../models/leadModel');
const Customer = require('../models/customerModel');
const Deal = require('../models/dealModel');
const User = require('../models/userModel');
const { ROLES, ENTITY_TYPE } = require('../constants/enums');

const normalizeEntityType = (rawType) => {
  if (!rawType) return null;
  const lower = rawType.trim().toLowerCase();
  return Object.values(ENTITY_TYPE).find((val) => val.toLowerCase() === lower) || null;
};

const verifyEntityAccess = async (entityType, entityId, user) => {
  if (user.role === ROLES.ADMIN) return true;

  let entity = null;
  if (entityType === ENTITY_TYPE.LEAD) {
    entity = await Lead.findById(entityId);
  } else if (entityType === ENTITY_TYPE.CUSTOMER) {
    entity = await Customer.findById(entityId);
  } else if (entityType === ENTITY_TYPE.DEAL) {
    entity = await Deal.findById(entityId);
  }

  if (!entity) return { notFound: true };

  const assignedId = entity.assignedTo ? entity.assignedTo.toString() : null;
  const createdById = entity.createdBy ? entity.createdBy.toString() : null;

  if (user.role === ROLES.SALES_EXECUTIVE) {
    return assignedId === user._id.toString();
  }

  if (user.role === ROLES.SALES_MANAGER) {
    const teamExecutives = await User.find({ manager: user._id }).select('_id');
    const teamExecutiveIds = teamExecutives.map((exec) => exec._id.toString());

    const isAssignedToTeam = assignedId && teamExecutiveIds.includes(assignedId);
    const isAssignedToSelf = assignedId === user._id.toString();
    const isCreatedBySelf = createdById === user._id.toString();

    return isAssignedToTeam || isAssignedToSelf || isCreatedBySelf;
  }

  return false;
};

const getEntityTimeline = async (req, res, next) => {
  try {
    const { entityType: rawEntityType, entityId } = req.params;
    const { page = 1, limit = 20, sortOrder = 'desc' } = req.query;

    const entityType = normalizeEntityType(rawEntityType);
    if (!entityType) {
      return res.status(400).json({
        success: false,
        message: `Invalid entityType '${rawEntityType}'. Allowed types: ${Object.values(ENTITY_TYPE).join(', ')}`
      });
    }

    if (!mongoose.Types.ObjectId.isValid(entityId)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid entity ID format.'
      });
    }

    const hasAccess = await verifyEntityAccess(entityType, entityId, req.user);
    if (hasAccess && hasAccess.notFound) {
      return res.status(404).json({
        success: false,
        message: `${entityType} with ID '${entityId}' not found.`
      });
    }

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: `Access denied. You do not have permission to view this ${entityType}'s audit timeline.`
      });
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;
    const sortDirection = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;

    const query = {
      entityType,
      entityId: new mongoose.Types.ObjectId(entityId)
    };

    const [timeline, totalRecords] = await Promise.all([
      Timeline.find(query)
        .populate('performedBy', 'name email role phone')
        .sort({ createdAt: sortDirection })
        .skip(skip)
        .limit(limitNum),
      Timeline.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalRecords / limitNum) || 1;

    res.status(200).json({
      success: true,
      message: `${entityType} timeline fetched successfully.`,
      data: {
        entityType,
        entityId,
        timeline,
        pagination: {
          currentPage: pageNum,
          pageSize: limitNum,
          totalRecords,
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

const getTimelineFeed = async (req, res, next) => {
  try {
    const {
      entityType: rawEntityType,
      performedBy,
      search,
      action,
      startDate,
      endDate,
      fromDate,
      toDate,
      page = 1,
      limit = 20,
      sortOrder = 'desc'
    } = req.query;

    const query = {};

    if (rawEntityType) {
      const entityType = normalizeEntityType(rawEntityType);
      if (entityType) {
        query.entityType = entityType;
      }
    }

    if (performedBy && mongoose.Types.ObjectId.isValid(performedBy)) {
      query.performedBy = performedBy;
    }

    if (action) {
      query.action = { $regex: action.trim(), $options: 'i' };
    }

    const searchTerm = (search || '').trim();
    if (searchTerm) {
      query.$or = [
        { action: { $regex: searchTerm, $options: 'i' } },
        { notes: { $regex: searchTerm, $options: 'i' } }
      ];
    }

    const start = startDate || fromDate;
    const end = endDate || toDate;
    if (start || end) {
      query.createdAt = {};
      if (start) query.createdAt.$gte = new Date(start);
      if (end) {
        const endDateTime = new Date(end);
        endDateTime.setHours(23, 59, 59, 999);
        query.createdAt.$lte = endDateTime;
      }
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      query.performedBy = req.user._id;
    } else if (req.user.role === ROLES.SALES_MANAGER) {
      const teamExecutives = await User.find({ manager: req.user._id }).select('_id');
      const teamIds = [req.user._id, ...teamExecutives.map((exec) => exec._id)];
      query.performedBy = { $in: teamIds };
    }

    const pageNum = Math.max(1, parseInt(page, 10) || 1);
    const limitNum = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));
    const skip = (pageNum - 1) * limitNum;
    const sortDirection = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;

    const [timeline, totalRecords] = await Promise.all([
      Timeline.find(query)
        .populate('performedBy', 'name email role phone')
        .sort({ createdAt: sortDirection })
        .skip(skip)
        .limit(limitNum),
      Timeline.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalRecords / limitNum) || 1;

    res.status(200).json({
      success: true,
      message: 'Global timeline feed fetched successfully.',
      data: {
        timeline,
        pagination: {
          currentPage: pageNum,
          pageSize: limitNum,
          totalRecords,
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

module.exports = {
  getEntityTimeline,
  getTimelineFeed
};
