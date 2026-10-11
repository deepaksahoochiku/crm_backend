const bcrypt = require('bcryptjs');
const User = require('../models/userModel');
const { generateToken } = require('../utils/token');
const { ROLES } = require('../constants/enums');

const register = async (req, res, next) => {
  try {
    const { name, email, password, phone, role, manager } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Name, email, and password are required.'
      });
    }

    const targetRole = role || ROLES.SALES_EXECUTIVE;

    if (!Object.values(ROLES).includes(targetRole)) {
      return res.status(400).json({
        success: false,
        message: `Invalid role '${targetRole}'. Allowed roles: ${Object.values(ROLES).join(', ')}`
      });
    }

    if (targetRole === ROLES.ADMIN) {
      const existingAdmin = await User.findOne({ role: ROLES.ADMIN });
      if (existingAdmin) {
        return res.status(400).json({
          success: false,
          message: 'An Admin already exists. Only one Admin is allowed in the system.'
        });
      }
    }

    let assignedManager = manager || null;
    if (req.user && req.user.role === ROLES.SALES_MANAGER) {
      assignedManager = req.user._id;
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'A user with this email already exists.'
      });
    }

    if (assignedManager) {
      const managerUser = await User.findById(assignedManager);
      if (!managerUser || managerUser.role !== ROLES.SALES_MANAGER || !managerUser.isActive) {
        return res.status(400).json({
          success: false,
          message: 'The assigned manager must be an existing and active Sales Manager.'
        });
      }
    }

    const user = await User.create({
      name,
      email,
      password,
      phone: phone || '',
      role: targetRole,
      manager: assignedManager
    });

    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt
    };

    if (user.manager) {
      userData.manager = user.manager;
    }

    res.status(201).json({
      success: true,
      message: `${user.role} created successfully`,
      data: {
        user: userData
      }
    });
  } catch (error) {
    next(error);
  }
};

const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide both email and password.'
      });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    if (!user.isActive) {
      return res.status(403).json({
        success: false,
        message: 'Your account has been deactivated. Please contact an administrator.'
      });
    }

    const isMatch = await bcrypt.compare(password, user.password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid email or password.'
      });
    }

    const token = generateToken(user._id, user.role);

    const userData = {
      id: user._id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      role: user.role,
      isActive: user.isActive
    };

    if (user.manager) {
      userData.manager = user.manager;
    }

    res.status(200).json({
      success: true,
      message: 'Login successful',
      data: {
        token,
        user: userData
      }
    });
  } catch (error) {
    next(error);
  }
};

const getUsers = async (req, res, next) => {
  try {
    const {
      search,
      keyword,
      q,
      role,
      status,
      isActive,
      page = 1,
      limit = 10,
      sortBy = 'createdAt',
      sortOrder = 'desc',
      sort
    } = req.query;

    const query = {};

    if (req.user.role === ROLES.SALES_MANAGER) {
      query.role = ROLES.SALES_EXECUTIVE;
    } else if (role) {
      const matchedRole = Object.values(ROLES).find(
        (r) => r.toLowerCase() === role.trim().toLowerCase()
      );
      if (matchedRole) {
        query.role = matchedRole;
      }
    }

    const searchTerm = (search || keyword || q || '').trim();
    if (searchTerm) {
      query.$or = [
        { name: { $regex: searchTerm, $options: 'i' } },
        { email: { $regex: searchTerm, $options: 'i' } }
      ];
    }

    const statusVal = status !== undefined ? status : isActive;
    if (statusVal !== undefined) {
      const normalizedStatus = String(statusVal).trim().toLowerCase();
      if (normalizedStatus === 'active' || normalizedStatus === 'true' || normalizedStatus === '1') {
        query.isActive = true;
      } else if (normalizedStatus === 'inactive' || normalizedStatus === 'false' || normalizedStatus === '0') {
        query.isActive = false;
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

    const [users, totalUsers] = await Promise.all([
      User.find(query)
        .select('-password')
        .populate('manager', 'name email role')
        .sort(sortOption)
        .skip(skip)
        .limit(limitNum),
      User.countDocuments(query)
    ]);

    const totalPages = Math.ceil(totalUsers / limitNum) || 1;

    res.status(200).json({
      success: true,
      message: 'Users fetched successfully',
      data: {
        users,
        pagination: {
          currentPage: pageNum,
          pageSize: limitNum,
          totalRecords: totalUsers,
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

const getUserById = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id)
      .select('-password')
      .populate('manager', 'name email role');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    if (req.user.role === ROLES.SALES_EXECUTIVE) {
      if (req.user._id.toString() !== user._id.toString()) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You can only view your own profile.'
        });
      }
    } else if (req.user.role === ROLES.SALES_MANAGER) {
      if (
        req.user._id.toString() !== user._id.toString() &&
        user.role !== ROLES.SALES_EXECUTIVE
      ) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: Sales Managers can only view Sales Executives or their own profile.'
        });
      }
    }

    res.status(200).json({
      success: true,
      message: 'User fetched successfully',
      data: {
        user
      }
    });
  } catch (error) {
    next(error);
  }
};

const updateUser = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { name, email, phone, role, isActive, manager, password } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    const isSelf = req.user._id.toString() === user._id.toString();
    const isAdmin = req.user.role === ROLES.ADMIN;
    const isManager = req.user.role === ROLES.SALES_MANAGER;
    const isTargetExecutive = user.role === ROLES.SALES_EXECUTIVE;

    const canUpdate = isAdmin || isSelf || (isManager && isTargetExecutive);

    if (!canUpdate) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to update this user.'
      });
    }

    if (role !== undefined && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only an Admin can change user roles.'
      });
    }

    if (manager !== undefined && !isAdmin) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only an Admin can assign or change manager.'
      });
    }

    if (isActive !== undefined) {
      if (isSelf) {
        return res.status(400).json({
          success: false,
          message: 'You cannot change your own active status.'
        });
      }
      if (!isAdmin && !isManager) {
        return res.status(403).json({
          success: false,
          message: 'Forbidden: You do not have permission to change active status.'
        });
      }
    }

    if (email && email.toLowerCase() !== user.email) {
      const emailExists = await User.findOne({
        email: email.toLowerCase(),
        _id: { $ne: id }
      });
      if (emailExists) {
        return res.status(400).json({
          success: false,
          message: 'A user with this email already exists.'
        });
      }
      user.email = email.toLowerCase();
    }

    if (name) user.name = name;
    if (phone !== undefined) user.phone = phone;

    if (role && isAdmin) {
      if (!Object.values(ROLES).includes(role)) {
        return res.status(400).json({
          success: false,
          message: `Invalid role '${role}'. Allowed roles: ${Object.values(ROLES).join(', ')}`
        });
      }
      if (role === ROLES.ADMIN && user.role !== ROLES.ADMIN) {
        const existingAdmin = await User.findOne({ role: ROLES.ADMIN });
        if (existingAdmin) {
          return res.status(400).json({
            success: false,
            message: 'An Admin already exists. Only one Admin is allowed in the system.'
          });
        }
      }
      user.role = role;
    }

    if (isActive !== undefined && (isAdmin || isManager)) {
      user.isActive = Boolean(isActive);
    }

    if (manager !== undefined && isAdmin) {
      if (manager === null || manager === '') {
        user.manager = null;
      } else {
        const managerUser = await User.findById(manager);
        if (
          !managerUser ||
          managerUser.role !== ROLES.SALES_MANAGER ||
          !managerUser.isActive
        ) {
          return res.status(400).json({
            success: false,
            message: 'The assigned manager must be an existing and active Sales Manager.'
          });
        }
        user.manager = managerUser._id;
      }
    }

    if (password) {
      if (password.length < 6) {
        return res.status(400).json({
          success: false,
          message: 'Password must be at least 6 characters long.'
        });
      }
      user.password = password;
    }

    await user.save();

    const updatedUser = await User.findById(id)
      .select('-password')
      .populate('manager', 'name email role');

    res.status(200).json({
      success: true,
      message: 'User updated successfully',
      data: {
        user: updatedUser
      }
    });
  } catch (error) {
    next(error);
  }
};

const toggleUserStatus = async (req, res, next) => {
  try {
    const { id } = req.params;
    const { isActive, status } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    const isAdmin = req.user.role === ROLES.ADMIN;
    const isManager = req.user.role === ROLES.SALES_MANAGER;

    if (user.role === ROLES.ADMIN) {
      return res.status(400).json({
        success: false,
        message: 'The Admin account cannot be deactivated.'
      });
    }

    if (isManager && user.role !== ROLES.SALES_EXECUTIVE) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Sales Managers can only change the active status of Sales Executives.'
      });
    }

    if (!isAdmin && !isManager) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: You do not have permission to change user active status.'
      });
    }

    let newStatus;
    if (isActive !== undefined) {
      newStatus = Boolean(isActive);
    } else if (status !== undefined) {
      newStatus = status === 'active' || status === true || status === '1';
    } else {
      newStatus = !user.isActive;
    }

    user.isActive = newStatus;
    await user.save();

    res.status(200).json({
      success: true,
      message: `User '${user.name}' has been ${user.isActive ? 'activated' : 'deactivated'} successfully.`,
      data: {
        user: {
          id: user._id,
          name: user.name,
          email: user.email,
          role: user.role,
          isActive: user.isActive
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

const deleteUser = async (req, res, next) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found.'
      });
    }

    if (req.user.role !== ROLES.ADMIN) {
      return res.status(403).json({
        success: false,
        message: 'Forbidden: Only an Admin can delete users.'
      });
    }

    if (user.role === ROLES.ADMIN || user._id.toString() === req.user._id.toString()) {
      return res.status(400).json({
        success: false,
        message: 'The Admin account cannot be deleted.'
      });
    }

    await User.findByIdAndDelete(id);

    res.status(200).json({
      success: true,
      message: `User '${user.name}' (${user.role}) deleted successfully.`
    });
  } catch (error) {
    next(error);
  }
};

const assignManager = async (req, res, next) => {
  try {
    const { executiveId, managerId } = req.body;

    if (!executiveId || !managerId) {
      return res.status(400).json({
        success: false,
        message: 'Both executiveId and managerId are required.'
      });
    }

    const executive = await User.findById(executiveId);
    if (!executive) {
      return res.status(404).json({
        success: false,
        message: 'Sales Executive not found.'
      });
    }

    if (executive.role !== ROLES.SALES_EXECUTIVE) {
      return res.status(400).json({
        success: false,
        message: `User '${executive.name}' has role '${executive.role}'. A manager can only be assigned to a Sales Executive.`
      });
    }

    if (!executive.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Cannot assign a manager to an inactive Sales Executive.'
      });
    }

    const manager = await User.findById(managerId);
    if (!manager) {
      return res.status(404).json({
        success: false,
        message: 'Sales Manager not found.'
      });
    }

    if (manager.role !== ROLES.SALES_MANAGER) {
      return res.status(400).json({
        success: false,
        message: `User '${manager.name}' has role '${manager.role}'. The assigned manager must have the role 'Sales Manager'.`
      });
    }

    if (!manager.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Cannot assign an inactive Sales Manager.'
      });
    }

    executive.manager = manager._id;
    await executive.save();

    res.status(200).json({
      success: true,
      message: `Sales Manager '${manager.name}' successfully assigned to '${executive.name}'.`,
      data: {
        executive: {
          id: executive._id,
          name: executive.name,
          email: executive.email,
          role: executive.role,
          manager: {
            id: manager._id,
            name: manager.name,
            email: manager.email
          }
        }
      }
    });
  } catch (error) {
    next(error);
  }
};

const getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user._id)
      .populate('manager', 'name email role phone');

    res.status(200).json({
      success: true,
      message: 'Current user profile fetched successfully.',
      data: {
        user
      }
    });
  } catch (error) {
    next(error);
  }
};

const logout = async (req, res, next) => {
  res.status(200).json({
    success: true,
    message: 'Logged out successfully.'
  });
};

module.exports = {
  register,
  login,
  getMe,
  logout,
  getUsers,
  getUserById,
  updateUser,
  toggleUserStatus,
  deleteUser,
  assignManager
};
