const mongoose = require('mongoose');
const Customer = require('../models/customerModel');
const User = require('../models/userModel');
const Timeline = require('../models/timelineModel');
const { ROLES, CUSTOMER_STATUS, ENTITY_TYPE } = require('../constants/enums');

const createCustomer = async (req, res, next) => {
  try {
    const { name, email, phone, company, address, assignedTo, status } = req.body;

    if (!name || !email || !phone) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and phone are required fields.'
      });
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
          message: 'Assigned user not found or is currently inactive.'
        });
      }

      if (req.user.role === ROLES.SALES_MANAGER) {
        const isTeamMember =
          targetUser.manager && targetUser.manager.toString() === req.user._id.toString();
        const isSelf = targetUser._id.toString() === req.user._id.toString();

        if (!isTeamMember && !isSelf) {
          return res.status(403).json({
            success: false,
            message: 'You can only assign customers to sales executives in your own team.'
          });
        }
      }

      finalAssignedTo = targetUser._id;
    }

    let customerStatus = CUSTOMER_STATUS.ACTIVE;
    if (status) {
      const matchedStatus = Object.values(CUSTOMER_STATUS).find(
        (s) => s.toLowerCase() === status.trim().toLowerCase()
      );
      if (matchedStatus) {
        customerStatus = matchedStatus;
      }
    }

    const customer = await Customer.create({
      name: name.trim(),
      email: email.trim().toLowerCase(),
      phone: phone.trim(),
      company: (company || '').trim(),
      address: (address || '').trim(),
      assignedTo: finalAssignedTo,
      status: customerStatus,
      createdBy: req.user._id
    });

    await Timeline.create({
      action: 'Customer Created',
      entityType: ENTITY_TYPE.CUSTOMER,
      entityId: customer._id,
      performedBy: req.user._id,
      newValue: {
        name: customer.name,
        email: customer.email,
        assignedTo: customer.assignedTo
      },
      notes: 'Customer created directly.'
    });

    const populatedCustomer = await Customer.findById(customer._id)
      .populate('assignedTo', 'name email role phone')
      .populate('createdBy', 'name email role');

    res.status(201).json({
      success: true,
      message: 'Customer created successfully.',
      data: {
        customer: populatedCustomer
      }
    });
  } catch (error) {
    next(error);
  }
};

const getCustomers = async (req, res, next) => {
  try {
    const {
      search,
      keyword,
      q,
      status,
      assignedTo,
      company,
      startDate,
      endDate,
      fromDate,
      toDate,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      sort
    } = req.query;

    const query = {};

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
      const searchConditions = [
        { name: searchRegex },
        { email: searchRegex },
        { phone: searchRegex },
        { company: searchRegex }
      ];

      if (query.$or) {
        query.$and = [{ $or: query.$or }, { $or: searchConditions }];
        delete query.$or;
      } else {
        query.$or = searchConditions;
      }
    }

    if (status) {
      const matchedStatus = Object.values(CUSTOMER_STATUS).find(
        (s) => s.toLowerCase() === status.trim().toLowerCase()
      );
      if (matchedStatus) {
        query.status = matchedStatus;
      }
    }

    if (company && !searchTerm) {
      query.company = { $regex: company.trim(), $options: 'i' };
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
      const direction = String(sortOrder).toLowerCase() === 'asc' ? 1 : -1;
      sortOption[sortBy] = direction;
    }

    const [customers, totalCustomers] = await Promise.all([
      Customer.find(query)
        .populate('assignedTo', 'name email phone role')
        .populate('createdBy', 'name email role')
        .populate('lead', 'name status company')
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum),
      Customer.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalCustomers / limitNum) || 1;

    res.status(200).json({
      success: true,
      message: 'Customers fetched successfully',
      data: {
        customers,
        pagination: {
          currentPage: pageNum,
          pageSize: limitNum,
          totalRecords: totalCustomers,
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

const getCustomerById = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid customer ID format.'
      });
    }

    const customer = await Customer.findById(id)
      .populate('assignedTo', 'name email phone role')
      .populate('createdBy', 'name email role')
      .populate('lead', 'name email status company source');

    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      const assignedId = customer.assignedTo ? customer.assignedTo._id.toString() : null;
      if (assignedId !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view customers assigned to you.'
        });
      }
    } else if (req.user.role === ROLES.SALES_MANAGER) {
      const teamExecutives = await User.find({ manager: req.user._id }).select('_id');
      const teamExecutiveIds = teamExecutives.map((exec) => exec._id.toString());
      const assignedId = customer.assignedTo ? customer.assignedTo._id.toString() : null;
      const createdById = customer.createdBy ? customer.createdBy._id.toString() : null;

      const isAssignedToTeam = assignedId && teamExecutiveIds.includes(assignedId);
      const isAssignedToSelf = assignedId === req.user._id.toString();
      const isCreatedBySelf = createdById === req.user._id.toString();

      if (!isAssignedToTeam && !isAssignedToSelf && !isCreatedBySelf) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only view customers within your team.'
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'Customer details retrieved successfully.',
      data: {
        customer
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateCustomer = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid customer ID format.'
      });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      if (customer.assignedTo.toString() !== req.user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only update customers assigned to you.'
        });
      }
    } else if (req.user.role === ROLES.SALES_MANAGER) {
      const teamExecutives = await User.find({ manager: req.user._id }).select('_id');
      const teamExecutiveIds = teamExecutives.map((exec) => exec._id.toString());
      const assignedId = customer.assignedTo.toString();
      const createdById = customer.createdBy.toString();

      const isAssignedToTeam = teamExecutiveIds.includes(assignedId);
      const isAssignedToSelf = assignedId === req.user._id.toString();
      const isCreatedBySelf = createdById === req.user._id.toString();

      if (!isAssignedToTeam && !isAssignedToSelf && !isCreatedBySelf) {
        return res.status(403).json({
          success: false,
          message: 'Access denied. You can only update customers within your team.'
        });
      }
    }

    const { name, email, phone, company, address, status, assignedTo } = req.body;

    const previousData = {
      name: customer.name,
      email: customer.email,
      phone: customer.phone,
      company: customer.company,
      address: customer.address,
      status: customer.status,
      assignedTo: customer.assignedTo
    };

    if (name) customer.name = name.trim();
    if (email) customer.email = email.trim().toLowerCase();
    if (phone) customer.phone = phone.trim();
    if (company !== undefined) customer.company = company.trim();
    if (address !== undefined) customer.address = address.trim();

    if (status) {
      const matchedStatus = Object.values(CUSTOMER_STATUS).find(
        (s) => s.toLowerCase() === status.trim().toLowerCase()
      );
      if (matchedStatus) {
        customer.status = matchedStatus;
      } else {
        return res.status(400).json({
          success: false,
          message: `Invalid customer status. Allowed values: ${Object.values(CUSTOMER_STATUS).join(', ')}`
        });
      }
    }

    if (assignedTo) {
      if (req.user.role === ROLES.SALES_EXECUTIVE) {
        return res.status(403).json({
          success: false,
          message: 'Sales Executives are not permitted to reassign customers.'
        });
      }

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
          message: 'Target user not found or inactive.'
        });
      }

      if (req.user.role === ROLES.SALES_MANAGER) {
        const isTeamMember =
          targetUser.manager && targetUser.manager.toString() === req.user._id.toString();
        const isSelf = targetUser._id.toString() === req.user._id.toString();

        if (!isTeamMember && !isSelf) {
          return res.status(403).json({
            success: false,
            message: 'You can only reassign customers to executives in your team.'
          });
        }
      }

      customer.assignedTo = targetUser._id;
    }

    await customer.save();

    await Timeline.create({
      action: 'Customer Updated',
      entityType: ENTITY_TYPE.CUSTOMER,
      entityId: customer._id,
      performedBy: req.user._id,
      previousValue: previousData,
      newValue: {
        name: customer.name,
        email: customer.email,
        phone: customer.phone,
        company: customer.company,
        address: customer.address,
        status: customer.status,
        assignedTo: customer.assignedTo
      },
      notes: 'Customer details updated.'
    });

    const updatedCustomer = await Customer.findById(customer._id)
      .populate('assignedTo', 'name email phone role')
      .populate('createdBy', 'name email role')
      .populate('lead', 'name status');

    res.status(200).json({
      success: true,
      message: 'Customer updated successfully.',
      data: {
        customer: updatedCustomer
      }
    });
  } catch (error) {
    next(error);
  }
};

const deleteCustomer = async (req, res, next) => {
  try {
    const { id } = req.params;

    if (!mongoose.Types.ObjectId.isValid(id)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid customer ID format.'
      });
    }

    if (req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Permission denied. Only Administrators can delete customer records.'
      });
    }

    const customer = await Customer.findById(id);
    if (!customer) {
      return res.status(404).json({
        success: false,
        message: 'Customer not found.'
      });
    }

    await Customer.findByIdAndDelete(id);

    await Timeline.create({
      action: 'Customer Deleted',
      entityType: ENTITY_TYPE.CUSTOMER,
      entityId: id,
      performedBy: req.user._id,
      previousValue: {
        name: customer.name,
        email: customer.email,
        company: customer.company
      },
      notes: 'Customer permanently deleted by Administrator.'
    });

    res.status(200).json({
      success: true,
      message: 'Customer deleted successfully.'
    });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer
};
