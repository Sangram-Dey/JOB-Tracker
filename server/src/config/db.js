import mongoose from 'mongoose';

// The one place the server connects to MongoDB. index.js awaits connectDb() before starting the API,
// so the backend never runs without a database. Models just use mongoose; they never connect themselves.
export async function connectDb(uri = process.env.MONGODB_URI) {
  mongoose.connection.on('disconnected', () => console.error('MongoDB connection lost; reconnecting…'));
  mongoose.connection.on('reconnected', () => console.log('MongoDB reconnected'));
  try {
    await mongoose.connect(uri, { serverSelectionTimeoutMS: 10_000 });
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error(`Could not connect to MongoDB: ${err.message}`);
    console.error('Check MONGODB_URI in server/.env and that Atlas allows this IP (Network Access). The server will not start.');
    process.exit(1);
  }
}
