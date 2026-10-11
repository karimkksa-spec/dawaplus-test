import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../server/db.mjs';
import { saveProduct, pharmacyProducts, decodeImage } from '../server/pharmacy.mjs';
import { createOrder, listOrders, changeOrder } from '../server/service.mjs';
import { upgradePharmacies } from '../server/migrate.mjs';
const owner = {
    id: 'pharmacy-demo',
    role: 'pharmacy'
  },
  other = {
    id: 'pharmacy-two-demo',
    role: 'pharmacy'
  },
  customer = {
    id: 'customer-demo',
    role: 'customer'
  },
  admin = {
    id: 'admin-demo',
    role: 'admin'
  },
  captain = {
    id: 'captain-demo',
    role: 'captain'
  };
const product = {
  name: 'مستلزم تجريبي للاختبار',
  category: 'مستلزمات طبية',
  price: 2000,
  stock: 10,
  active: true
};
test('An old pharmacy edit cannot overwrite inventory reserved by a new order', async () => {
  const db = openDatabase(':memory:', true);
  try {
    const p = await saveProduct(db, owner, product);
    await createOrder(db, customer, body(p.id), 'stock-race-key');
    await assert.rejects(async () => await saveProduct(db, owner, {
      ...product,
      expectedStock: 10
    }, p.id));
    assert.equal((await db.prepare('SELECT stock FROM products WHERE id=?').get(p.id)).stock, 9);
  } finally {
    db.close();
  }
});
function body(id) {
  return {
    items: [{
      productId: id,
      quantity: 1
    }],
    paymentMethod: 'cash',
    deliveryLocation: {
      lat: 12.85,
      lng: 44.98
    },
    zoneId: 'mansoura',
    address: 'عدن المنصورة عنوان اختبار',
    phone: '770000001'
  };
}
test('Pharmacy creates product, sees only own orders, reviews and marks ready before dispatch', async () => {
  const db = openDatabase(':memory:', true);
  try {
    const p = await saveProduct(db, owner, product);
    assert.ok((await pharmacyProducts(db, owner)).some(x => x.id === p.id));
    assert.ok(!(await pharmacyProducts(db, other)).some(x => x.id === p.id));
    await assert.rejects(async () => await saveProduct(db, other, {
      ...product,
      price: 1
    }, p.id));
    const o = await createOrder(db, customer, body(p.id), 'pharmacy-flow-key');
    assert.equal((await listOrders(db, owner)).length, 1);
    assert.equal((await listOrders(db, other)).length, 0);
    await assert.rejects(async () => await changeOrder(db, other, o.id, {
      status: 'confirmed',
      reviewed: true
    }));
    await changeOrder(db, owner, o.id, {
      status: 'confirmed',
      reviewed: true
    });
    await assert.rejects(async () => await changeOrder(db, admin, o.id, {
      status: 'assigned',
      captainId: captain.id
    }));
    await changeOrder(db, owner, o.id, {
      status: 'ready'
    });
    await assert.rejects(async () => await changeOrder(db, owner, o.id, {
      status: 'assigned',
      captainId: captain.id
    }));
    await changeOrder(db, admin, o.id, {
      status: 'assigned',
      captainId: captain.id
    });
    await changeOrder(db, captain, o.id, {
      status: 'picked_up'
    });
    await changeOrder(db, captain, o.id, {
      status: 'delivered',
      cashCollected: true
    });
    assert.equal((await listOrders(db, owner))[0].payment_status, 'collected');
  } finally {
    db.close();
  }
});
test('Reject mixed-pharmacy carts and hidden products without reserving stock', async () => {
  const db = openDatabase(':memory:', true);
  try {
    const p = await saveProduct(db, owner, product),
      q = await saveProduct(db, other, product);
    const request = body(p.id);
    request.items.push({
      productId: q.id,
      quantity: 1
    });
    await assert.rejects(async () => await createOrder(db, customer, request, 'mixed-pharmacy-key'));
    assert.equal((await db.prepare('SELECT stock FROM products WHERE id=?').get(p.id)).stock, 10);
    await saveProduct(db, owner, {
      ...product,
      active: false,
      expectedStock: 10
    }, p.id);
    await assert.rejects(async () => await createOrder(db, customer, body(p.id), 'hidden-product-key'));
    assert.equal((await listOrders(db, admin)).length, 0);
  } finally {
    db.close();
  }
});
test('Photo validator rejects SVG and forged MIME and accepts actual PNG signature', () => {
  assert.throws(() => decodeImage('data:image/svg+xml;base64,PHN2Zz4='));
  assert.throws(() => decodeImage('data:image/png;base64,' + Buffer.from('not an image, deliberately').toString('base64')));
  const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a1S0AAAAASUVORK5CYII=';
  assert.equal(decodeImage('data:image/png;base64,' + png).extension, 'png');
});
test('Migration preserves existing users, sessions, products and order foreign keys; reruns safely', async () => {
  const db = new DatabaseSync(':memory:');
  try {
    db.exec(`PRAGMA foreign_keys=ON;CREATE TABLE users(id TEXT PRIMARY KEY,name TEXT NOT NULL,phone TEXT UNIQUE NOT NULL,role TEXT NOT NULL CHECK(role IN ('customer','admin','captain')),password TEXT NOT NULL);CREATE TABLE sessions(token TEXT PRIMARY KEY,user_id TEXT REFERENCES users(id));CREATE TABLE products(id TEXT PRIMARY KEY);CREATE TABLE orders(id TEXT PRIMARY KEY,customer_id TEXT REFERENCES users(id));INSERT INTO users VALUES ('old-user','old','770000009','customer','hash');INSERT INTO sessions VALUES ('token','old-user');INSERT INTO products VALUES ('old-product');INSERT INTO orders VALUES ('old-order','old-user');`);
    upgradePharmacies(db);
    upgradePharmacies(db);
    assert.equal((await db.prepare('SELECT count(*) n FROM users').get()).n, 1);
    assert.equal((await db.prepare('SELECT count(*) n FROM sessions').get()).n, 1);
    assert.equal((await db.prepare('SELECT pharmacy_id FROM orders').get()).pharmacy_id, 'pharmacy-main');
    assert.deepEqual(await db.prepare('PRAGMA foreign_key_check').all(), []);
  } finally {
    db.close();
  }
});
