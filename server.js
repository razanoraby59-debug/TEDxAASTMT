require("dotenv").config();

const express = require("express");
const cors = require("cors");
const mongoose = require("mongoose");

const app = express();

app.use(cors());
app.use(express.json());

app.use(express.static("C:\\Users\\Lenovo\\tedx"));


// ========================================
// USER SCHEMA
// ========================================

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


// ========================================
// EVENT SCHEMA
// ========================================

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


// ========================================
// REGISTRATION SCHEMA
// ========================================

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


// ========================================
// CONNECT TO MONGODB
// ========================================

mongoose.connect(process.env.MONGODB_URI)

    .then(async () => {

        console.log("MongoDB connected successfully!");

        // Create the event automatically
        // if it doesn't already exist.

        await Event.findOneAndUpdate(

            { name: "TEDxAASTMT 2026" },

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

    })

    .catch((error) => {

        console.error(
            "MongoDB connection error:",
            error
        );

    });


// ========================================
// TEST ROUTE
// ========================================

app.get("/", (req, res) => {

    res.send(
        "TEDxAASTMT backend is working!"
    );

});


// ========================================
// SIGNUP
// ========================================

app.post("/signup", async (req, res) => {

    try {

        const {
            name,
            email,
            password
        } = req.body;

        if (!name || !email || !password) {

            return res.status(400).json({
                message: "Please fill in all fields."
            });

        }

        const existingUser =
            await User.findOne({ email });

        if (existingUser) {

            return res.status(400).json({
                message:
                    "An account with this email already exists."
            });

        }

        const newUser = new User({
            name,
            email,
            password
        });

        await newUser.save();

        console.log(
            "New user created:",
            email
        );

        res.status(201).json({
            message:
                "Account created successfully!"
        });

    }

    catch (error) {

        console.error(
            "Signup error:",
            error
        );

        res.status(500).json({
            message:
                "Something went wrong while creating your account."
        });

    }

});


// ========================================
// LOGIN
// ========================================

app.post("/login", async (req, res) => {

    try {

        const {
            email,
            password
        } = req.body;

        const user =
            await User.findOne({ email });

        if (!user) {

            return res.status(401).json({
                message:
                    "Invalid email or password."
            });

        }

        if (user.password !== password) {

            return res.status(401).json({
                message:
                    "Invalid email or password."
            });

        }

        res.json({

            message:
                "Login successful!",

            user: {
                name: user.name,
                email: user.email
            }

        });

    }

    catch (error) {

        console.error(
            "Login error:",
            error
        );

        res.status(500).json({
            message:
                "Something went wrong while logging in."
        });

    }

});


// ========================================
// GET NUMBER OF SEATS LEFT
// ========================================

app.get("/event-status", async (req, res) => {

    try {

        const event =
            await Event.findOne({
                name: "TEDxAASTMT 2026"
            });

        if (!event) {

            return res.status(404).json({
                message: "Event not found."
            });

        }

        res.json({

            seatsRemaining:
                event.seatsRemaining,

            totalSeats:
                event.totalSeats,

            registrationOpen:
                event.seatsRemaining > 0

        });

    }

    catch (error) {

        console.error(
            "Event status error:",
            error
        );

        res.status(500).json({
            message:
                "Could not get event status."
        });

    }

});


// ========================================
// TICKET REGISTRATION
// ========================================

app.post("/register", async (req, res) => {

    const session =
        await mongoose.startSession();

    try {

        const {
            name,
            registration_number,
            email
        } = req.body;


        // -------------------------------
        // BASIC VALIDATION
        // -------------------------------

        if (
            !name ||
            !registration_number ||
            !email
        ) {

            return res.status(400).json({
                message:
                    "Please fill in all fields."
            });

        }


        const cleanEmail =
            email.trim().toLowerCase();

        const cleanRegNo =
            registration_number.trim();


        // -------------------------------
        // TRANSACTION
        // -------------------------------

        let savedRegistration;


        await session.withTransaction(
            async () => {

                // Check if this person already registered

                const existing =
                    await Registration.findOne({

                        $or: [
                            {
                                email: cleanEmail
                            },
                            {
                                registration_number:
                                    cleanRegNo
                            }
                        ]

                    }).session(session);


                if (existing) {

                    throw new Error(
                        "ALREADY_REGISTERED"
                    );

                }


                // Take ONE seat atomically.
                //
                // This is important:
                // only one person can take
                // the final available seat.

                const event =
                    await Event.findOneAndUpdate(

                        {
                            name:
                                "TEDxAASTMT 2026",

                            seatsRemaining: {
                                $gt: 0
                            }

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


                // No seats left

                if (!event) {

                    throw new Error(
                        "EVENT_FULL"
                    );

                }


                // Save registration

                const registration =
                    new Registration({

                        name:
                            name.trim(),

                        registration_number:
                            cleanRegNo,

                        email:
                            cleanEmail

                    });


                await registration.save({
                    session
                });


                savedRegistration =
                    registration;

            }
        );


        console.log(
            "New ticket registration:",
            savedRegistration.email
        );


        res.status(201).json({

            message:
                "Seat reserved successfully!",

            registration: {

                name:
                    savedRegistration.name,

                registration_number:
                    savedRegistration.registration_number,

                email:
                    savedRegistration.email

            }

        });

    }

    catch (error) {

        console.error(
            "Registration error:",
            error
        );


        if (
            error.message ===
            "EVENT_FULL"
        ) {

            return res.status(400).json({

                message:
                    "Registration is closed. All 100 seats have been taken."

            });

        }


        if (
            error.message ===
            "ALREADY_REGISTERED"
        ) {

            return res.status(400).json({

                message:
                    "This email or registration number has already been used."

            });

        }


        res.status(500).json({

            message:
                "Something went wrong while registering."

        });

    }

    finally {

        await session.endSession();

    }

});


// ========================================
// START SERVER
// ========================================

app.listen(5000, () => {

    console.log(
        "Server running on port 5000"
    );

});