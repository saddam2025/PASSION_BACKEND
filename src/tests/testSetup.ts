import mongoose from 'mongoose';

process.env.TEST_ARGON2_MEMORY_COST ??= '4096';
process.env.TEST_ARGON2_TIME_COST ??= '1';
mongoose.set('autoIndex', false);
