import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.mjs';
import { createOrder, changeOrder, listOrders } from '../server/service.mjs';
const customer = {
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
async function fixture() {
  const db = openDatabase(':memory:', true);
  const p = await db.prepare('SELECT * FROM products LIMIT 1').get();
  const body = {
    items: [{
      productId: p.id,
      quantity: 2
    }],
    paymentMethod: 'cash',
    deliveryLocation: {
      lat: 12.85,
      lng: 44.98
    },
    zoneId: 'mansoura',
    address: 'عدن، المنصورة، شارع تجريبي',
    phone: '770000001'
  };
  return {
    db,
    p,
    body
  };
}
test('Server pricing, reservation, idempotency and full delivery workflow', async () => {
  const {
    db,
    p,
    body
  } = await fixture();
  try {
    const o = await createOrder(db, customer, {
      ...body,
      total: 1
    }, 'test-123456');
    assert.deepEqual(await createOrder(db, customer, body, 'test-123456'), o);
    let row = (await listOrders(db, customer))[0];
    assert.equal(row.total, p.price * 2 + 1000);
    assert.equal((await db.prepare('SELECT stock FROM products WHERE id=?').get(p.id)).stock, 23);
    await assert.rejects(async () => await changeOrder(db, captain, o.id, {
      status: 'confirmed'
    }));
    await assert.rejects(async () => await changeOrder(db, admin, o.id, {
      status: 'confirmed'
    }));
    await changeOrder(db, admin, o.id, {
      status: 'confirmed',
      reviewed: true
    });
    await changeOrder(db, admin, o.id, {status:'preparing'});
    await changeOrder(db, admin, o.id, {
      status: 'ready'
    });
    await changeOrder(db, admin, o.id, {
      status: 'assigned',
      captainId: captain.id
    });
    await changeOrder(db, captain, o.id, {
      status: 'picked_up'
    });
    await assert.rejects(async () => await changeOrder(db, captain, o.id, {
      status: 'delivered'
    }));
    await changeOrder(db,captain,o.id,{status:'on_the_way'});
    await changeOrder(db,captain,o.id,{status:'arrived'});
    await changeOrder(db, captain, o.id, {
      status: 'delivered',
      cashCollected: true
    });
    assert.equal((await listOrders(db, customer))[0].payment_status, 'collected');
    await assert.rejects(async () => await changeOrder(db, admin, o.id, {
      status: 'cancelled'
    }));
  } finally {
    db.close();
  }
});
test('Cancellation restores stock exactly once', async () => {
  const {
    db,
    p,
    body
  } = await fixture();
  try {
    const o = await createOrder(db, customer, body, 'cancel-12345');
    await changeOrder(db, customer, o.id, {
      status: 'cancelled'
    });
    assert.equal((await db.prepare('SELECT stock FROM products WHERE id=?').get(p.id)).stock, 25);
    await assert.rejects(async () => await changeOrder(db, customer, o.id, {
      status: 'cancelled'
    }));
  } finally {
    db.close();
  }
});
test('Reject invalid quantities, unavailable wallets and insufficient stock atomically', async () => {
  const {
    db,
    p,
    body
  } = await fixture();
  try {
    for (const quantity of [-1, 0, 1.5, 21]) await assert.rejects(async () => await createOrder(db, customer, {
      ...body,
      items: [{
        productId: p.id,
        quantity
      }]
    }, 'invalid-12345'));
    await assert.rejects(async () => await createOrder(db, customer, {
      ...body,
      paymentMethod: 'wallet'
    }, 'wallet-12345'));
    await db.prepare('UPDATE products SET stock=1 WHERE id=?').run(p.id);
    await assert.rejects(async () => await createOrder(db, customer, body, 'stock-12345'));
    assert.equal((await listOrders(db, customer)).length, 0);
    assert.equal((await db.prepare('SELECT stock FROM products WHERE id=?').get(p.id)).stock, 1);
  } finally {
    db.close();
  }
});
test('Customer and captain cannot access or mutate other orders', async () => {
  const {
    db,
    body
  } = await fixture();
  try {
    const o = await createOrder(db, customer, body, 'scope-12345');
    assert.deepEqual(await listOrders(db, {
      id: 'other',
      role: 'customer'
    }), []);
    assert.deepEqual(await listOrders(db, captain), []);
    await assert.rejects(async () => await changeOrder(db, {
      id: 'other',
      role: 'customer'
    }, o.id, {
      status: 'cancelled'
    }));
    await assert.rejects(async () => await changeOrder(db, customer, o.id, {
      status: 'confirmed',
      reviewed: true
    }));
  } finally {
    db.close();
  }
});
