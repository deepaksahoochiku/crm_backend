const express = require('express');
const {
  createCustomer,
  getCustomers,
  getCustomerById,
  updateCustomer,
  deleteCustomer
} = require('../controllers/customerController');
const {
  protect,
  accessByAdmin
} = require('../middlewares/authMiddleware');

const router = express.Router();

router.post('/', protect, createCustomer);
router.get('/', protect, getCustomers);
router.get('/:id', protect, getCustomerById);
router.put('/:id', protect, updateCustomer);
router.patch('/:id', protect, updateCustomer);
router.delete('/:id', protect, accessByAdmin, deleteCustomer);

module.exports = router;
