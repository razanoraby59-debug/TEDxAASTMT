require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const mongoose = require("mongoose");

const app = express();

app.use(cors());
app.use(express.json());

// ==================== MONGODB CONNECTION ====================

let mongoPromise = null;

async function connectDB() {
    if (mongoose.connection.readyState === 1) {
        return;
    }

    if (!process.env.MONGODB_URI) {
        throw new Error("MONGODB_URI is not configured.");
    }

    if (!mongoPromise) {
        mongoPromise = mongoose.connect(process.env.MONGODB_URI, {
            serverSelectionTimeoutMS: 10000
        });
    }

    await mongoPromise;
}

// ==================== FRONTEND FILES ====================

app.use(express.static(__dirname));

// ==================== HTML PAGES ====================

app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "frontend.html"));
});

app.get("/register.html", (req, res) => {
    res.sendFile(path.join(__dirname, "register.html"));
});

app.get("/signup.html", (req, res) => {
    res.sendFile(path.join(__dirname, "signup.html"));
});

app.get("/login.html", (req, res) => {
    res.sendFile(path.join(__dirname, "login.html"));
});

app.get("/privacy.html", (req, res) => {
    res.sendFile(path.join(__dirname, "privacy.html"));
});

app.get("/terms.html", (req, res) => {
    res.sendFile(path.join(__dirname, "terms.html"));
});

app.get("/rate.html", (req, res) => {
    res.sendFile(path.join(__dirname, "rate.html"));
});

// ==================== USER ====================

const userSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    password: {
        type: String,
        required: true
    }
});

const User = mongoose.model("User", userSchema);

// ==================== EVENT ====================

const eventSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        unique: true
    },
    totalSeats: {
        type: Number,
        required: true
    },
    seatsRemaining: {
        type: Number,
        required: true
    }
});

const Event = mongoose.model("Event", eventSchema);

// ==================== REGISTRATION ====================

const registrationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true
    },
    registration_number: {
        type: String,
        required: true,
        unique: true
    },
    email: {
        type: String,
        required: true,
        unique: true
    },
    registeredAt: {
        type: Date,
        default: Date.now
    }
});

const Registration = mongoose.model(
    "Registration",
    registrationSchema
);

// ==================== SIGN UP ====================

app.post("/signup", async (req, res) => {
    try {
        await connectDB();

        const { name, email, password } = req.body;

        if (!name || !email || !password) {
            return res.status(400).json({
                message: "Please fill in all fields."
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        const existingUser = await User.findOne({
            email: cleanEmail
        });

        if (existingUser) {
            return res.status(400).json({
                message: "An account with this email already exists."
            });
        }

        const user = new User({
            name: name.trim(),
            email: cleanEmail,
            password
        });

        await user.save();

        res.status(201).json({
            message: "Account created successfully!"
        });

    } catch (error) {
        console.error("SIGNUP ERROR:", error);

        res.status(500).json({
            message: "Server error."
        });
    }
});

// ==================== LOGIN ====================

app.post("/login", async (req, res) => {
    try {
        await connectDB();

        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({
                message: "Please enter your email and password."
            });
        }

        const cleanEmail = email.trim().toLowerCase();

        const user = await User.findOne({
            email: cleanEmail
        });

        if (!user || user.password !== password) {
            return res.status(401).json({
                message: "Invalid email or password."
            });
        }

        res.json({
            message: "Login successful!",
            user: {
                name: user.name,
                email: user.email
            }
        });

    } catch (error) {
        console.error("LOGIN ERROR:", error);

        res.status(500).json({
            message: "Server error."
        });
    }
});

// ==================== EVENT STATUS ====================

app.get("/event-status", async (req, res) => {
    try {
        await connectDB();

        let event = await Event.findOne({
            name: "TEDxAASTMT 2026"
        });

        if (!event) {
            event = await Event.create({
                name: "TEDxAASTMT 2026",
                totalSeats: 100,
                seatsRemaining: 100,
                registrationOpen: true
            });
        }

        res.json({
            seatsRemaining: event.seatsRemaining,
            totalSeats: event.totalSeats,
            registrationOpen: true
        });

    } catch (error) {
        console.error("Event status error:", error);

        res.status(500).json({
            message: "Failed to load event status."
        });
    }
});
// ==================== REGISTER ====================

app.post("/register", async (req, res) => {
    const session = await mongoose.startSession();

    try {
        await connectDB();

        const {
            name,
            registration_number,
            email
        } = req.body;

        if (!name || !registration_number || !email) {
            return res.status(400).json({
                message: "Please fill in all fields."
            });
        }

        const cleanName = name.trim();
        const cleanEmail = email.trim().toLowerCase();
        const cleanRegNo = registration_number.trim();

        let savedRegistration;

        await session.withTransaction(async () => {

            const existingRegistration =
                await Registration.findOne({
                    $or: [
                        { email: cleanEmail },
                        { registration_number: cleanRegNo }
                    ]
                }).session(session);

            if (existingRegistration) {
                throw new Error("ALREADY_REGISTERED");
            }

            const event = await Event.findOneAndUpdate(
                {
                    name: "TEDxAASTMT 2026",
                    seatsRemaining: { $gt: 0 }
                },
                {
                    $inc: {
                        seatsRemaining: -1
                    }
                },
                {
                    new: true,
                    session
                }
            );

            if (!event) {
                throw new Error("EVENT_FULL");
            }

            const registration = new Registration({
                name: cleanName,
                registration_number: cleanRegNo,
                email: cleanEmail
            });

            await registration.save({
                session
            });

            savedRegistration = registration;
        });

        res.status(201).json({
            message: "Seat reserved successfully!",
            registration: {
                name: savedRegistration.name,
                registration_number:
                    savedRegistration.registration_number,
                email: savedRegistration.email
            }
        });

    } catch (error) {

        console.error("REGISTRATION ERROR:", error);

        if (error.message === "EVENT_FULL") {
            return res.status(400).json({
                message: "Sorry, all seats are full."
            });
        }

        if (error.message === "ALREADY_REGISTERED") {
            return res.status(400).json({
                message:
                    "This email or registration number is already registered."
            });
        }

        res.status(500).json({
            message: "Server error."
        });

    } finally {
        await session.endSession();
    }
});

// ==================== LOCAL SERVER ====================

if (require.main === module) {
    const PORT = process.env.PORT || 5000;

    connectDB()
        .then(async () => {

            console.log("MongoDB connected successfully!");

            await Event.findOneAndUpdate(
                {
                    name: "TEDxAASTMT 2026"
                },
                {
                    $setOnInsert: {
                        name: "TEDxAASTMT 2026",
                        totalSeats: 100,
                        seatsRemaining: 100
                    }
                },
                {
                    upsert: true,
                    new: true
                }
            );

            console.log("Event seat counter ready!");

            app.listen(PORT, () => {
                console.log(
                    `TEDxAASTMT server running on port ${PORT}`
                );
            });

        })
        .catch((error) => {
            console.error("MongoDB startup error:", error);
        });
}

// ==================== VERCEL ====================

module.exports = app;
