require("dotenv").config();
const express = require("express");
const bodyParser = require("body-parser");
const mongoose = require("mongoose");
const randomize = require("randomatic");
const session = require("express-session");
const passport = require("passport");
const LocalStrategy = require('passport-local').Strategy;
const passportLocalMongoose = require("passport-local-mongoose");
const path = require('path');
const { Schema } = require("mongoose");
const { resolveSoa } = require("dns");
const flash = require('connect-flash');
const app = express();

app.set('view engine', 'ejs');
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json());
app.use(express.static(path.join(__dirname + '/public')));

app.use(session({
    secret: process.env.SECRET_SESSION,
    resave: false,
    saveUninitialized: true,
}));

app.use(passport.initialize());
app.use(passport.session());
app.use(flash());

mongoose.connect('mongodb://localhost:27017/QmateDB', { useNewUrlParser: true, useUnifiedTopology: true, });
mongoose.set('useCreateIndex', true);
mongoose.set('useFindAndModify', false);

const teacherSchema = new mongoose.Schema({
    username: String,
    password: String
});

const classroomCodeSchema = new mongoose.Schema({
    username: String,
    classroom_code: String
});

const storageSchema = new mongoose.Schema({
    form: Array,
    tests: Array,
    classroom_code: String,
    pending_students: Array,
    registered_students: Array
});

teacherSchema.plugin(passportLocalMongoose);

const Teacher = mongoose.model("Teacher", teacherSchema);
const classroomCodes = mongoose.model("classroomCode", classroomCodeSchema);
const storage = mongoose.model("storage", storageSchema);

passport.use(Teacher.createStrategy());

passport.serializeUser(Teacher.serializeUser());
passport.deserializeUser(Teacher.deserializeUser());


app.get("/", (req, res) => {
    res.render("homePage", { error: "" });
});

app.get('/teacher/signup', (req, res) => {
    res.render('teacherSignup', { wrongPasswordError: "", signupError: "" })
})
app.get('/teacher/login', (req, res) => {
    res.render('teacherLogin', { loginError: '' })
})

app.get('/about', (req, res) => {
    res.render('about')
})

app.get('/contact', (req, res) => {
    res.render('contact');
})


app.post("/teacher/signup", (req, res) => {

    if (req.body.password.length < 6) {
        res.render('teacherSignup', { wrongPasswordError: 'Password length cannot be less than 6', signupError: "" });
        return;
    }

    Teacher.register({ username: req.body.username }, req.body.password, (err, user) => {
        if (err) {
            res.render("teacherSignup", { wrongPasswordError: "", signupError: 'There was some error signing you up!' });
            return;
        } else {

            let new_classroom_code = randomize("Aa0", 8);
            let check = true;

            while (check) {
                check = false;
                classroomCodes.findOne({ classroom_code: new_classroom_code }, (err, obj) => {
                    if (err) {
                        res.render("homePage", { error: err });
                    } else {
                        if (obj) {
                            check = true;
                        }
                    }
                });
            }
            const newClassObj = new classroomCodes({
                username: req.body.username,
                classroom_code: new_classroom_code
            });

            const newStorage = new storage({
                form: [],
                classroom_code: new_classroom_code,
                pending_students: [],
                registered_students: [],
                tests: [],
                results: []
            });
            newClassObj.save();
            newStorage.save();

            passport.authenticate("local")(req, res, () => {
                res.redirect("/hostPage/" + new_classroom_code);
            });
        }
    });
});

app.post("/teacher/login", (req, res) => {
    const user = new Teacher({
        username: req.body.username,
        password: req.body.password
    });

    req.login(user, (err) => {
        if (err) {
            console.log(err)
            res.render("teacherLogin", { loginError: 'There was a problem during sign up!' });
            return;
        } else {
            passport.authenticate("local", { failureRedirect: '/teacher/login' })(req, res, (err) => {
                if (err) {
                    console.log(err)
                    res.render("teacherLogin", { loginError: "Problems occured while signing up. Please try again." });
                    return;
                }
                classroomCodes.findOne({ username: req.body.username }, (err, obj) => {
                    if (err) {
                        console.log(err);
                        return;
                    } else {
                        if (obj == null) {
                            res.render("teacherLogin", { loginError: "Problems occured while signing up. Please try again." });
                            return;
                        }
                        res.redirect("/hostPage/" + obj.classroom_code);
                        return;
                    }
                });
            });

        }
    });
});

app.get("/hostPage/:classCode", (req, res) => {

    if (req.isAuthenticated()) {

        const classCode = req.params.classCode;
        storage.findOne({ classroom_code: classCode }, (err, obj) => {
            if (err) {
                console.log(err)
            } else {
                if (obj == null) {
                    res.redirect('/teacher/login');
                    return;
                }
                let testNames = [];
                let n = obj.tests.length;
                for (let i = 0; i < n; ++i) {
                    testNames.push(obj.tests[i].name);
                }
                n = obj.registered_students.length;
                let registered_students_mod = obj.registered_students;
                for (let i = 0; i < n; i++) {
                    delete registered_students_mod[i]['studentID'];
                }
                res.render("hostPage", { class_code: classCode, formData: obj.form, testNames: testNames, pendingStudents: obj.pending_students, registeredStudents: registered_students_mod });
            }
        });

    } else {
        res.render("teacherLogin", { loginError: "Problems occured while signing you up. Please try again" });
    }
});

app.post('/rejectStudent/:classCode', (req, res) => {

    storage.findOne({ classroom_code: req.params.classCode }, (err, obj) => {
        if (err) {
            console.log(error);
        } else {
            obj.pending_students.splice(req.body.idx, 1);
            obj.save();
            res.send('');
            // res.redirect("/hostPage/" + req.params.classCode);
        }
    })
});

app.post("/acceptStudent/:classCode", (req, res) => {
    storage.findOne({ classroom_code: req.params.classCode }, (err, obj) => {
        if (err) {
            console.log(error)
        } else {
            let idx = req.body.idx;

            let data = obj.pending_students[idx];
            data['studentID'] = obj.registered_students.length;
            obj.registered_students.push(data);
            obj.pending_students.splice(idx, 1);
            obj.save();
            res.send('')
        }
    })
})

app.post('/deleteRegisteredStudents/:classCode', (req, res) => {

    storage.findOne({ classroom_code: req.params.classCode }, (err, obj) => {
        if (err) {
            console.log(err);
        } else {

            const studentIdx = req.body.studentIndexes;
            let n = studentIdx.length;

            for (let i = 0; i < n; i++) {
                for (let j = 0; j < obj.registered_students.length; j++) {
                    if (obj.registered_students[j].studentID == studentIdx[i]) {
                        obj.registered_students.splice(j, 1);
                        break;
                    }
                }
            }

            for (let i = 0; i < obj.registered_students.length; i++) {
                obj.registered_students[i].studentID = i;
            }
            obj.markModified('registered_students');
            obj.save();
            res.send('')
        }
    });
});

app.post("/createForm/:class_code", (req, res) => {
    let inputEle = req.body.inputName;
    let form = [];
    if (typeof(inputEle) === 'string') {
        let tempArr = [];
        tempArr.push(inputEle);
        inputEle = tempArr;
    }
    for (let i = 0; i < inputEle.length; i++) {
        if (inputEle[i] == "") continue;
        else form.push(inputEle[i]);
    }
    storage.findOneAndUpdate({ classroom_code: req.params.class_code }, { form: form }, (err) => {
        if (err) {
            console.log(err);
        }
    });
    res.redirect("/hostPage/" + req.params.class_code);
});

app.get("/logout", (req, res) => {
    req.logout();
    res.redirect('/');
});

app.get("/createNewForm/:class_code", (req, res) => {
    storage.findOneAndUpdate({ classroom_code: req.params.class_code }, { form: [] }, (err) => {
        if (err) {
            console.log(err);
        }
    });
    res.redirect("/hostPage/" + req.params.class_code);
});

app.post("/createNewTest/:class_code", (req, res) => {

    if (req.body.testName.length == 0) {
        res.redirect("/hostPage/" + req.params.class_code);
        return;
    }

    const testObject = {
        name: req.body.testName,
        questions: [],
        time: [],
        testObj: [],
        results: []
    }
    var flag = true;
    storage.findOne({ classroom_code: req.params.class_code }, (err, obj) => {
        if (err) {
            console.log(err);
        } else {
            let n = obj.tests.length;
            for (let i = 0; i < n; i++) {
                if (obj.tests[i].name == req.body.testName) {
                    flag = false;
                    break;
                }
            }
            if (flag) {
                obj.tests.push(testObject);
                obj.save();
                res.redirect("/createTest/" + req.params.class_code + "/" + req.body.testName + "/" + 'create');
            } else {
                res.redirect('/hostPage/' + req.params.class_code);
            }

        }
    });

});

app.get("/:class_code/deleteTest/:testName", (req, res) => {

    const testName = req.params.testName;
    storage.findOne({ classroom_code: req.params.class_code }, (err, obj) => {
        if (err) return err;
        let n = obj.tests.length;
        for (let i = 0; i < n; ++i) {
            if (obj.tests[i].name == testName) {
                obj.tests.splice(i, 1);
                break;
            }
        }
        obj.save();
    });
    res.redirect('/hostPage/' + req.params.class_code);
});

app.get("/createTest/:class_code/:testName/:type", (req, res) => {
    if (req.isAuthenticated()) {
        var testObj = {
            test: [],
            time: []
        };
        if (req.params.type == 'create') {

            res.render("createTest", { class_code: req.params.class_code, testName: req.params.testName, testObj: testObj });
        } else if (req.params.type = 'edit') {
            storage.findOne({ classroom_code: req.params.class_code }, (err, obj) => {
                if (err) {
                    console.log(err);
                    res.redirect('/hostPage/' + req.params.class_code);
                } else {
                    let n = obj.tests.length;
                    let testName = req.params.testName;
                    for (let i = 0; i < n; ++i) {
                        if (testName == obj.tests[i].name) {
                            testObj.test = obj.tests[i].questions;
                            testObj.time = obj.tests[i].time;
                            break;
                        }
                    }
                    res.render("createTest", { class_code: req.params.class_code, testName: req.params.testName, testObj: testObj });
                }
            });
        }

    } else {
        res.redirect('/');
    }
});

app.post("/saveTest/:class_code/:testName", (req, res) => {
    const testData = req.body;
    const testName = req.params.testName;
    storage.findOne({ classroom_code: req.params.class_code }, (err, obj) => {
        if (err) {
            console.log(err);
            return err;
        } else {
            let n = testData.test.length;
            let testObj = [];
            for (let i = 0; i < n; ++i) {
                let question = testData.test[i].question;
                let options = testData.test[i].options;
                testObj.push({
                    question: question,
                    options: options
                });
            }
            const finalTestObj = {
                name: testName,
                questions: testData.test,
                time: testData.time,
                testObj: testObj,
                results: []
            };
            n = obj.tests.length;
            for (let i = 0; i < n; ++i) {
                if (obj.tests[i].name == testName) {
                    obj.tests.splice(i, 1, finalTestObj);
                }
            }
            obj.save();
        }
        res.send("");
    });
});

app.post('/registerStudent/:classCode', (req, res) => {

    const formData = req.body;
    storage.findOne({ classroom_code: req.params.classCode }, (err, obj) => {
        if (err) {
            console.log(err);
        } else {
            obj.pending_students.push(formData);
            obj.save();
            res.send('');
        }
    })
});

app.get('/joinPage/:classCode', (req, res) => {
    storage.findOne({ classroom_code: req.params.classCode }, (err, obj) => {
        if (err) {
            console.log(err);
        } else {
            if (obj == null) {
                res.redirect('/');
            } else {
                res.render('joinPage', { classCode: req.params.classCode, formData: obj.form });
            }
        }
    });
});

app.post("/checkClassCode", (req, res) => {
    const classCode = req.body.classCode;
    storage.findOne({ classroom_code: classCode }, (err, obj) => {
        if (err) {
            console.log(err);
        } else {
            let resp = {
                classroomExists: true
            }
            if (obj == null) {
                resp.classroomExists = false;
                res.send(JSON.stringify(resp));
            } else {
                res.send(JSON.stringify(resp));
            }
        }
    })
});

app.get("/joinExam/:classCode", (req, res) => {
    const classCode = req.params.classCode;
    storage.findOne({ classroom_code: classCode }, (err, obj) => {
        if (err) {
            console.log(err);
        } else {
            res.render('joinExam', { classCode: req.params.classCode, formData: obj.form });
        }
    });

});

app.post("/checkStudentDetails/:classCode", (req, res) => {
    const classCode = req.params.classCode;
    const testName = req.body.testName;
    let rawCurrStudent = req.body;
    delete rawCurrStudent.testName;
    let currStudent = rawCurrStudent;

    storage.findOne({ classroom_code: classCode }, (err, obj) => {
        if (err) {
            console.log(err);
        } else {
            let n = obj.registered_students.length;
            let present = false;
            let studentID = '-1';
            let fields = Object.keys(currStudent);
            let len = fields.length;
            for (let i = 0; i < n; i++) {
                let flag = true;
                let curObj = obj.registered_students[i];
                for (let j = 0; j < len; j++) {
                    if (curObj[fields[j]] != currStudent[fields[j]]) {
                        flag = false;
                        break;
                    }
                }
                if (flag) {
                    present = true;
                    studentID = obj.registered_students[i].studentID;
                    break;
                }
            }


            let attempted = false;
            let foundTest = false;
            n = obj.tests.length;
            for (let i = 0; i < n; ++i) {
                if (obj.tests[i].name == testName) {
                    foundTest = true;
                    let response = obj.tests[i].results;
                    let k = response.length;
                    for (let j = 0; j < k; j++) {
                        if (response[j].studentID == studentID) {
                            attempted = true;
                        }
                    }
                }
            }

            n = obj.tests.length;
            let timeArr = [];
            for (let i = 0; i < n; i++) {
                if (testName == obj.tests[i].name) {
                    timeArr = obj.tests[i].time;
                    break;
                }
            }
            let data = {
                foundTest: foundTest,
                attempted: attempted,
                present: present,
                time: timeArr,
                studentID: studentID
            }
            res.send(JSON.stringify(data))
        }
    });
});

app.get('/exam/:classCode/:testName', (req, res) => {
    const classCode = req.params.classCode;
    const testName = req.params.testName;
    storage.findOne({ classroom_code: classCode }, (err, obj) => {
        if (err) {
            console.log(err);
        } else {
            let n = obj.tests.length;
            let testObj = [];
            for (let i = 0; i < n; i++) {
                if (testName == obj.tests[i].name) {
                    testObj = obj.tests[i].testObj;
                    break;
                }
            }
            res.render('examPage', { classCode: classCode, testData: testObj });
        }
    })

});

app.post("/saveResponse/:classCode/:testName", (req, res) => {

    storage.findOne({ classroom_code: req.params.classCode }, (err, obj) => {
        if (err) {
            console.log(err);
        } else {

            const testName = req.params.testName;
            let n = obj.tests.length;

            for (let i = 0; i < n; ++i) {
                if (obj.tests[i].name == testName) {
                    obj.tests[i].results.push(req.body);
                    break;
                }
            }
            obj.markModified('tests');
            obj.save();
            res.send('');
        }
    });
});


app.get("/endPage", (req, res) => {
    res.render('endPage');
});

app.get("/resultPage/:classCode/:testName", (req, res) => {
    storage.findOne({ classroom_code: req.params.classCode }, (err, obj) => {
        if (err) {
            console.log(err);
        } else {
            let n = obj.tests.length;
            let response = [];
            let test = [];
            let scores = [];
            for (let i = 0; i < n; ++i) {
                if (obj.tests[i].name == req.params.testName) {
                    response = obj.tests[i].results;
                    test = obj.tests[i].questions;
                    break;
                }
            }
            let respLen = response.length;
            let registerLen = obj.registered_students.length;

            for (let i = 0; i < respLen; i++) {

                let scoreObj = {
                    details: {},
                    score: {}
                };
                let id = response[i].studentID;

                for (let j = 0; j < registerLen; j++) {
                    if (obj.registered_students[j].studentID == id) {
                        scoreObj.details = obj.registered_students[j];
                        break;
                    }
                }
                let studentResponse = response[i].response;
                let len = studentResponse.length;
                let studentScore = 0;
                let scoreArray = [];

                for (let idx = 0; idx < len; idx++) {

                    let questionID = studentResponse[idx].id;
                    let selectedOptionID = studentResponse[idx].value;

                    let testLen = test.length;
                    for (let k = 0; k < testLen; ++k) {
                        if (test[k].question.id == questionID) {
                            if (test[k].correctOption == selectedOptionID) {
                                studentScore++;
                                scoreArray.push('1');
                            } else {
                                scoreArray.push('0');
                            }
                            break;
                        }
                    }
                }
                scoreObj.score = {
                    studentScore: studentScore,
                    scoreArray: scoreArray
                }
                scores.push(scoreObj);
            }
            res.render("resultPage", { testName: req.params.testName, scores: scores });
        }
    })

})


const portName = 3000;
app.listen(portName, () => {
    console.log("Server running on port 3000");
});