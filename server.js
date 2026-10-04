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
        required: true,
        trim: true
    },

    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
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
        unique: true,
        trim: true
    },

    totalSeats: {
        type: Number,
        required: true
    },

    seatsRemaining: {
        type: Number,
        required: true
    },

    registrationOpen: {
        type: Boolean,
        default: true
    }
});

const Event = mongoose.model("Event", eventSchema);

// ==================== REGISTRATION ====================

const registrationSchema = new mongoose.Schema({
    name: {
        type: String,
        required: true,
        trim: true
    },

    registration_number: {
        type: String,
        required: true,
        unique: true,
        trim: true
    },

    email: {
        type: String,
        required: true,
        unique: true,
        lowercase: true,
        trim: true
    },

    registeredAt: {
        type: Date,
        default: Date.now
    }
});

// These indexes make duplicate registrations impossible
// even if two requests arrive at almost the same time.
registrationSchema.index(
    { registration_number: 1 },
    { unique: true }
);

registrationSchema.index(
    { email: 1 },
    { unique: true }
);

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

        const cleanName = name.trim();
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
            name: cleanName,
            email: cleanEmail,
            password
        });

        await user.save();

        res.status(201).json({
            message: "Account created successfully!"
        });

    } catch (error) {
        console.error("SIGNUP ERROR:", error);

        // Duplicate email from MongoDB
        if (error.code === 11000) {
            return res.status(400).json({
                message: "An account with this email already exists."
            });
        }

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

// ==================== ENSURE EVENT EXISTS ====================

async function ensureEvent() {
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

    return event;
}

// ==================== EVENT STATUS ====================

app.get("/event-status", async (req, res) => {
    try {
        const event = await ensureEvent();

        res.json({
            seatsRemaining: event.seatsRemaining,
            totalSeats: event.totalSeats,
            registrationOpen: event.seatsRemaining > 0
        });

    } catch (error) {
        console.error("EVENT STATUS ERROR:", error);

        res.status(500).json({
            message: "Failed to load event status."
        });
    }
});

// ==================== REGISTER ====================

app.post("/register", async (req, res) => {
    let session = null;

    try {
        await connectDB();

        const {
            name,
            registration_number,
            email
        } = req.body;

        // ----------------------------
        // BASIC VALIDATION
        // ----------------------------

        if (!name || !registration_number || !email) {
            return res.status(400).json({
                message: "Please fill in all fields."
            });
        }

        const cleanName = String(name).trim();
        const cleanEmail = String(email).trim().toLowerCase();
        const cleanRegNo = String(registration_number).trim();

        if (cleanName.length < 3) {
            return res.status(400).json({
                message: "Please enter your full name."
            });
        }

        if (!/^\d{9}$/.test(cleanRegNo)) {
            return res.status(400).json({
                message: "Registration number must be exactly 9 digits."
            });
        }

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(cleanEmail)) {
            return res.status(400).json({
                message: "Please enter a valid email address."
            });
        }

        // ----------------------------
        // START DATABASE TRANSACTION
        // ----------------------------

        session = await mongoose.startSession();

        let savedRegistration = null;

        await session.withTransaction(async () => {

            // ----------------------------
            // CHECK EMAIL
            // ----------------------------

            const existingByEmail =
                await Registration.findOne({
                    email: cleanEmail
                }).session(session);

            if (existingByEmail) {
                throw new Error("EMAIL_ALREADY_REGISTERED");
            }

            // ----------------------------
            // CHECK REGISTRATION NUMBER
            // ----------------------------

            const existingByRegNo =
                await Registration.findOne({
                    registration_number: cleanRegNo
                }).session(session);

            if (existingByRegNo) {
                throw new Error("REGISTRATION_NUMBER_ALREADY_REGISTERED");
            }

            // ----------------------------
            // GET / CREATE EVENT
            // ----------------------------

            let event = await Event.findOne({
                name: "TEDxAASTMT 2026"
            }).session(session);

            if (!event) {
                event = await Event.create(
                    [{
                        name: "TEDxAASTMT 2026",
                        totalSeats: 100,
                        seatsRemaining: 100,
                        registrationOpen: true
                    }],
                    { session }
                );

                event = event[0];
            }

            // ----------------------------
            // RESERVE ONE SEAT ATOMICALLY
            // ----------------------------

            const updatedEvent =
                await Event.findOneAndUpdate(
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

            if (!updatedEvent) {
                throw new Error("EVENT_FULL");
            }

            // ----------------------------
            // CREATE REGISTRATION
            // ----------------------------

            const registration =
                new Registration({
                    name: cleanName,
                    registration_number: cleanRegNo,
                    email: cleanEmail
                });

            await registration.save({
                session
            });

            savedRegistration = registration;
        });

        // ----------------------------
        // SUCCESS
        // ----------------------------

        return res.status(201).json({
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

        // ----------------------------
        // SPECIFIC DUPLICATE ERRORS
        // ----------------------------

        if (error.message === "EMAIL_ALREADY_REGISTERED") {
            return res.status(400).json({
                message: "This email is already registered."
            });
        }

        if (
            error.message ===
            "REGISTRATION_NUMBER_ALREADY_REGISTERED"
        ) {
            return res.status(400).json({
                message:
                    "This registration number is already registered."
            });
        }

        // ----------------------------
        // EVENT FULL
        // ----------------------------

        if (error.message === "EVENT_FULL") {
            return res.status(400).json({
                message: "Sorry, all seats are full."
            });
        }

        // ----------------------------
        // MONGODB DUPLICATE KEY
        // ----------------------------

        if (error.code === 11000) {

            const duplicateField =
                Object.keys(error.keyPattern || {})[0];

            if (duplicateField === "email") {
                return res.status(400).json({
                    message:
                        "This email is already registered."
                });
            }

            if (
                duplicateField ===
                "registration_number"
            ) {
                return res.status(400).json({
                    message:
                        "This registration number is already registered."
                });
            }

            return res.status(400).json({
                message:
                    "This registration already exists."
            });
        }

        // ----------------------------
        // GENERAL ERROR
        // ----------------------------

        return res.status(500).json({
            message:
                "Something went wrong while reserving your seat. Please try again."
        });

    } finally {

        if (session) {
            await session.endSession();
        }
    }
});

// ==================== LOCAL SERVER ====================

if (require.main === module) {

    const PORT = process.env.PORT || 5000;

    connectDB()
        .then(async () => {

            console.log(
                "MongoDB connected successfully!"
            );

            await Event.findOneAndUpdate(
                {
                    name: "TEDxAASTMT 2026"
                },
                {
                    $setOnInsert: {
                        name: "TEDxAASTMT 2026",
                        totalSeats: 100,
                        seatsRemaining: 100,
                        registrationOpen: true
                    }
                },
                {
                    upsert: true,
                    new: true
                }
            );

            console.log(
                "Event seat counter ready!"
            );

            // Make sure unique indexes exist
            await Registration.init();

            console.log(
                "Registration indexes ready!"
            );

            app.listen(PORT, () => {
                console.log(
                    `TEDxAASTMT server running on port ${PORT}`
                );
            });

        })
        .catch((error) => {
            console.error(
                "MongoDB startup error:",
                error
            );
        });
}

// ==================== VERCEL ====================

module.exports = app;
