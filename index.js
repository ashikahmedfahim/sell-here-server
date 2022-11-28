const express = require('express');
const app = express();
const cors = require('cors');
require('dotenv').config();
const multer = require('multer');
const path = require('path');
const { MongoClient, ObjectId } = require("mongodb");
const jwt = require('jsonwebtoken');

const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, 'public/');
    },
    filename: function (req, file, cb) {
        cb(null, Date.now() + path.extname(file.originalname));
    }
})
const upload = multer({ storage: storage });

const PORT = process.env.PORT || 5000;
const uri = process.env.DB_URL;

app.use(cors());
app.use(express.json({ limit: "30mb", extended: true }));
app.use(express.urlencoded({ limit: "30mb", extended: true }));
app.use('/public', express.static('public'))

const verifyToken = (req, res, next) => {
    try {
        const bearerHeader = req.headers.authorization;
        if (bearerHeader) {
            const bearer = bearerHeader.split(' ');
            const bearerToken = bearer[1];
            //verify token
            jwt.verify(bearerToken, process.env.JWT_SECRET, (err, authData) => {
                if (err) {
                    res.sendStatus(401);
                } else {
                    req.user = authData;
                    next();
                }
            });
        } else {
            res.sendStatus(401);
        }
    } catch (err) {
        res.sendStatus(401);
    }
}

const isAdmin = (req, res, next) => {
    if (req.user.accountType === 'admin') {
        next();
    } else {
        res.sendStatus(401);
    }
}

const isSeller = (req, res, next) => {
    if (req.user.accountType === 'seller') {
        next();
    } else {
        res.sendStatus(401);
    }
}

const isAdminORSeller = (req, res, next) => {
    if (req.user.accountType === 'admin' || req.user.accountType === 'seller') {
        next();
    } else {
        res.sendStatus(401);
    }
}

const isBuyer = (req, res, next) => {
    if (req.user.accountType === 'buyer') {
        next();
    } else {
        res.sendStatus(401);
    }
}

const client = new MongoClient(uri);
async function run() {
    try {
        app.get('/', (req, res) => {
            res.send('Hello World!')
        });

        app.post('/upload', upload.single('image'), function (req, res, next) {
            try {
                const ServerUrl = process.env.SERVER_URL;
                res.send(`${ServerUrl}/${req.file.path}`);
            } catch (err) {
                throw new Error(err);
            }
        });

        app.post('/jwt', async (req, res) => {
            try {
                const { email } = req.body;

                const usersCollection = client.db("sell-here").collection("users");
                const query = { email };
                const user = await usersCollection.findOne(query);

                if (!user) {
                    res.status(401).send('Invalid email');
                } else {
                    const token = jwt.sign(
                        { email, accountType: user.accountType },
                        process.env.JWT_SECRET,
                        { expiresIn: '4h' }
                    );
                    res.status(200).json({ token });
                }
            } catch (err) {
                res.status(500).send(err);
            }
        });

        app.post('/register', async (req, res) => {
            try {
                const { name, email, accountType, img } = req.body;
                const usersCollection = client.db('sell-here').collection('users');
                const query = { email };
                const user = await usersCollection.findOne(query);

                if (!user) {
                    const result =
                        await usersCollection.insertOne({ name, email, accountType, img, isVerified: false });
                }

                const token = jwt.sign({ email }, process.env.JWT_SECRET, { expiresIn: '4h' });

                res.status(200).json({ token });
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.get('/blogs', async (req, res) => {
            try {
                const blogsCollection = client.db('sell-here').collection('blogs');
                const blogs = await blogsCollection.find().toArray();
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.get('/users', verifyToken, isAdmin, async (req, res) => {
            try {
                const { accountType } = req.query;
                let query;
                if (accountType) {
                    query = { accountType };
                } else {
                    query = {};
                }
                const usersCollection = client.db('sell-here').collection('users');
                const users = await usersCollection.find(query).toArray();
                res.send(users);
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.delete('/users/:id', verifyToken, isAdmin, async (req, res) => {
            try {
                const { id } = req.params;
                const usersCollection = client.db('sell-here').collection('users');
                const result = await usersCollection.deleteOne({ _id: ObjectId(id) });
                res.send(result);
            } catch (error) {
                res.status(500).send
            }
        });

        app.patch('/verify-user/:id', verifyToken, isAdmin, async (req, res) => {
            try {
                const { id } = req.params;
                const usersCollection = client.db('sell-here').collection('users');
                const query = { _id: ObjectId(id) };
                const update = { $set: { isVerified: true } };
                const result = await usersCollection.updateOne(query, update);
                res.send(result);
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.get('/categories', async (req, res) => {
            try {
                const categoriesCollection = client.db('sell-here').collection('categories');
                const categories = await categoriesCollection.find().toArray();
                res.send(categories);
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.get('/categories/:id/products', async (req, res) => {
            try {
                const { id } = req.params;
                const productsCollection = client.db('sell-here').collection('products');
                const query = { categoryId: ObjectId(id) };
                // products with seller info
                const products = await productsCollection.aggregate([
                    { $match: query },
                    {
                        $lookup: {
                            from: 'users',
                            localField: 'userId',
                            foreignField: '_id',
                            as: 'seller'
                        }
                    },
                    { $unwind: '$seller' }
                ]).toArray();
                res.send(products);
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.get('/my-products', verifyToken, isSeller, async (req, res) => {
            try {
                const { email } = req.user;
                const usersCollection = client.db('sell-here').collection('users');
                const user = await usersCollection.findOne({ email });
                const productsCollection = client.db('sell-here').collection('products');
                const query = { userId: ObjectId(user._id) };
                const products = await productsCollection.find(query).toArray();
                res.send(products);
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.get('/my-orders', verifyToken, isBuyer, async (req, res) => {
            try {
                const { email } = req.user;
                const usersCollection = client.db('sell-here').collection('users');
                const user = await usersCollection.findOne({
                    email: email
                });
                const productsCollection = client.db('sell-here').collection('products');
                const query = { buyerId: ObjectId(user._id) };
                let products = await productsCollection.find(
                    { bookings: { $elemMatch: { buyerId: ObjectId(user._id) } } }
                ).toArray();
                products = products.map(product => {
                    product?.buyerId?.toString() == user._id.toString() ? product.isOwner = true : product.isOwner = false;
                    return product;
                });
                res.send(products);
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.get('/reported-products', verifyToken, isAdmin, async (req, res) => {
            try {
                const productsCollection = client.db('sell-here').collection('products');
                const query = { isReported: true };
                const products = await productsCollection.find(query).toArray();
                res.send(products);
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.patch('/reported-products/:id', verifyToken, isBuyer, async (req, res) => {
            try {
                const { id } = req.params;
                const productsCollection = client.db('sell-here').collection('products');
                const query = { _id: ObjectId(id) };
                const update = { $set: { isReported: true } };
                const result = await productsCollection.updateOne(query, update);
                res.send(result);
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.get('/advertised-products', async (req, res) => {
            try {
                const productsCollection = client.db('sell-here').collection('products');
                const query = { isAdvertised: true, isSold: false };
                const products = await productsCollection.find(query).toArray();
                res.send(products);
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.patch('/advertised-products/:id', verifyToken, isSeller, async (req, res) => {
            try {
                const { id } = req.params;
                const productsCollection = client.db('sell-here').collection('products');
                const query = { _id: ObjectId(id) };
                const update = { $set: { isAdvertised: true } };
                const result = await productsCollection.updateOne(query, update);
                res.send(result);
            } catch (error) {
                res.status(500).send(error);
            }
        });


        app.post('/products', verifyToken, isSeller, upload.single('image'), async (req, res) => {
            try {
                const {
                    name,
                    location,
                    originalPrice,
                    resalePrice,
                    yearsOfUse,
                    yearOfPurchase,
                    category,
                    description,
                    condition,
                    mobile
                } = req.body;
                const usersCollection = client.db('sell-here').collection('users');
                const user = await usersCollection.findOne({ email: req.user.email });
                const productsCollection = client.db('sell-here').collection('products');
                const ServerUrl = process.env.SERVER_URL;
                const result = await productsCollection.insertOne({
                    name,
                    location,
                    originalPrice,
                    resalePrice,
                    yearsOfUse,
                    yearOfPurchase,
                    imageUrl: `${ServerUrl}/${req.file.path}`,
                    categoryId: ObjectId(category),
                    description,
                    condition,
                    mobile,
                    userId: ObjectId(user._id),
                    createdAt: new Date(),
                    isSold: false,
                    isAdvertised: false,
                    isReported: false,
                    bookings: []
                });
                res.send(result);
            } catch (error) {
                res.status(500).send
            }
        });

        app.delete('/products/:id', verifyToken, isAdminORSeller, async (req, res) => {
            try {
                const { id } = req.params;
                const productsCollection = client.db('sell-here').collection('products');
                const result = await productsCollection.deleteOne({ _id: ObjectId(id) });
                res.send(result);
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.post('/orders', verifyToken, isBuyer, async (req, res) => {
            try {
                const { product: productId } = req.body;
                const usersCollection = client.db('sell-here').collection('users');
                const user = await usersCollection
                    .findOne({ email: req.user.email });
                const productsCollection = client.db('sell-here').collection('products');
                const product = await productsCollection.findOne({ _id: ObjectId(productId) });
                const newBooking = {
                    buyerId: ObjectId(user._id),
                    mobile: req.body.mobile,
                    location: req.body.location,
                };
                bookings = [...product.bookings, newBooking];
                const result = await productsCollection.updateOne(
                    { _id: ObjectId(productId) },
                    { $set: { bookings } }
                );
                res.send(result);
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.patch('/buy-now/:id', verifyToken, isBuyer, async (req, res) => {
            try {
                const { id } = req.params;
                const usersCollection = client.db('sell-here').collection('users');
                const user = await usersCollection.findOne({ email: req.user.email });
                const productsCollection = client.db('sell-here').collection('products');
                const query = { _id: ObjectId(id) };
                const update = {
                    $set: {
                        isSold: true,
                        buyerId: ObjectId(user._id),
                    }
                };
                const result = await productsCollection.updateOne(query, update);
                res.send(result);
            } catch (error) {
                res.status(500).send(error);
            }
        });

        app.get('*', (req, res) => {
            res.status(404).send('404 Not Found');
        });
    } catch (error) {
        console.log(error);
    }
}
run().catch(console.dir);


app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

