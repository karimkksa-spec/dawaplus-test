import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../server/db.mjs';
import { createOrder, changeOrder, listOrders } from '../server/service.mjs';
import { shareLocation } from '../server/location.mjs';
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
  },
  pharmacy = {
    id: 'pharmacy-demo',
    role: 'pharmacy'
  };
async function fixture() {
  const db = openDatabase(':memory:', true),
    p = await db.prepare('SELECT * FROM products LIMIT 1').get();
  return {
    db,
    p,
    body: {
      items: [{
        productId: p.id,
        quantity: 1
      }],
      paymentMethod: 'cash',
      zoneId: 'mansoura',
      phone: '770000001',
      deliveryLocation: {
        lat: 12.85,
        lng: 44.98
      }
    }
  };
}
async function assign(db, id) {
  await changeOrder(db, admin, id, {
    status: 'confirmed',
    reviewed: true
  });
  await changeOrder(db, admin, id, {
    status: 'ready'
  });
  await changeOrder(db, admin, id, {
    status: 'assigned',
    captainId: captain.id
  });
}
const position = () => ({
  lat: 12.84,
  lng: 44.99,
  accuracy: 15,
  observedAt: Date.now()
});
test('Map point is required, finite and inside Aden; invalid requests never reserve inventory', async () => {
  const {
    db,
    p,
    body
  } = await fixture();
  try {
    for (const deliveryLocation of [undefined, null, {}, {
      lat: '12.85',
      lng: 44.98
    }, {
      lat: NaN,
      lng: 44.98
    }, {
      lat: 12.85,
      lng: Infinity
    }, {
      lat: 15,
      lng: 44.98
    }, {
      lat: 12.85,
      lng: 50
    }]) await assert.rejects(async () => await createOrder(db, customer, {
      ...body,
      address: 'A written address cannot replace the pin',
      deliveryLocation
    }, 'invalid-map-point'));
    assert.equal((await listOrders(db, customer)).length, 0);
    assert.equal((await db.prepare('SELECT stock FROM products WHERE id=?').get(p.id)).stock, p.stock);
    await createOrder(db, customer, body, 'valid-map-point');
    const o = (await listOrders(db, customer))[0];
    assert.equal(o.delivery_lat, 12.85);
    assert.equal(o.delivery_lng, 44.98);
    assert.equal(o.address, '');
  } finally {
    db.close();
  }
});
test('Only assigned captain can share; customers see only own order locations; pharmacy does not see captain tracking', async () => {
  const {
    db,
    body
  } = await fixture();
  try {
    const {
      id
    } = await createOrder(db, customer, body, 'tracking-scope-key');
    await assert.rejects(async () => await shareLocation(db, captain, id, position()));
    await assign(db, id);
    for (const user of [customer, admin, pharmacy, {
      id: 'another-captain',
      role: 'captain'
    }]) await assert.rejects(async () => await shareLocation(db, user, id, position()), e => e.status === 403);
    await shareLocation(db, captain, id, position());
    assert.equal((await listOrders(db, customer))[0].captain_location.lat, 12.84);
    assert.equal((await listOrders(db, admin))[0].captain_location.lng, 44.99);
    assert.equal((await listOrders(db, pharmacy))[0].captain_location, null);
    assert.deepEqual(await listOrders(db, {
      id: 'other',
      role: 'customer'
    }), []);
    await shareLocation(db, captain, id, {
      ...position(),
      lat: 12.83
    });
    assert.equal((await db.prepare('SELECT count(*) n FROM order_locations').get()).n, 1);
    await shareLocation(db, captain, id, {
      action: 'stop'
    });
    assert.equal((await listOrders(db, customer))[0].captain_location, null);
  } finally {
    db.close();
  }
});
test('Tracking rejects invalid or stale fixes and clears when delivered or cancelled', async () => {
  for (const terminal of ['delivered', 'cancelled']) {
    const {
      db,
      body
    } = await fixture();
    try {
      const {
        id
      } = await createOrder(db, customer, body, 'tracking-finish-key');
      await assign(db, id);
      for (const invalid of [{
        lat: 91
      }, {
        lng: 181
      }, {
        lat: '12'
      }, {
        accuracy: -1
      }, {
        accuracy: NaN
      }, {
        accuracy: 10001
      }, {
        observedAt: Date.now() - 70000
      }, {
        observedAt: Date.now() + 60000
      }]) await assert.rejects(async () => await shareLocation(db, captain, id, {
        ...position(),
        ...invalid
      }));
      await shareLocation(db, captain, id, position());
      await assert.rejects(async () => await shareLocation(db, captain, id, {
        ...position(),
        observedAt: Date.now() - 5000
      }));
      if (terminal === 'delivered') {
        await changeOrder(db, captain, id, {
          status: 'picked_up'
        });
        await changeOrder(db, captain, id, {
          status: terminal,
          cashCollected: true
        });
      } else await changeOrder(db, admin, id, {
        status: terminal
      });
      assert.equal((await listOrders(db, customer))[0].captain_location, null);
      await assert.rejects(async () => await shareLocation(db, captain, id, position()), e => e.status === 409);
    } finally {
      db.close();
    }
  }
});
