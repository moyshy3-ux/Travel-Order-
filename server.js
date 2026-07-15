require('dotenv').config();
const express = require('express');
const path = require('path');
const { createClient } = require('@supabase/supabase-js');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY in environment. Check your .env file.');
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const VALID_STATUSES = ['Still in the Office', 'Disseminated to Region', 'Received from Region', 'Done'];

// ---------- GET all travel orders (grouped-friendly: sorted by date) ----------
app.get('/api/travel-orders', async (req, res) => {
  const { data, error } = await supabase
    .from('travel_orders')
    .select('*')
    .order('order_year', { ascending: true })
    .order('order_month', { ascending: true })
    .order('seq_number', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ---------- GET all employees (for name autocomplete + division lookup) ----------
app.get('/api/employees', async (req, res) => {
  const { data, error } = await supabase
    .from('employees')
    .select('*')
    .order('name', { ascending: true });

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// ---------- CREATE a new travel order (to_no auto-generated unless typed manually) ----------
app.post('/api/travel-orders', async (req, res) => {
  const { travel_dates, name_of_personnel, division, status, to_no } = req.body;

  if (!Array.isArray(travel_dates) || travel_dates.length === 0 || !name_of_personnel) {
    return res.status(400).json({ error: 'travel_dates (at least one date) and name_of_personnel are required' });
  }

  const payload = {
    travel_dates,
    name_of_personnel,
    division: division || '',
    status: status && VALID_STATUSES.includes(status) ? status : 'Still in the Office',
  };

  // leave blank to auto-generate (handled by the DB trigger); type a value to set it manually
  if (to_no && to_no.trim()) {
    payload.to_no = to_no.trim();
  }

  // if creator already knows the status is further along, stamp the date fields too
  if (payload.status === 'Disseminated to Region') {
    payload.date_disseminated_to_region = req.body.date_disseminated_to_region || new Date().toISOString().slice(0, 10);
  }
  if (payload.status === 'Received from Region') {
    payload.date_disseminated_to_region = req.body.date_disseminated_to_region || new Date().toISOString().slice(0, 10);
    payload.date_received = req.body.date_received || new Date().toISOString().slice(0, 10);
  }

  const { data, error } = await supabase
    .from('travel_orders')
    .insert(payload)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: `TO number "${payload.to_no}" is already used. Try a different one or leave it blank to auto-generate.` });
    }
    return res.status(500).json({ error: error.message });
  }
  res.status(201).json(data);
});

// ---------- UPDATE a travel order (edit fields / change status) ----------
app.put('/api/travel-orders/:id', async (req, res) => {
  const { id } = req.params;
  const allowedFields = [
    'to_no', 'travel_dates', 'name_of_personnel', 'division', 'status',
    'date_disseminated_to_region', 'date_received'
  ];

  const update = {};
  for (const key of allowedFields) {
    if (key in req.body) update[key] = req.body[key];
  }

  if (update.status && !VALID_STATUSES.includes(update.status)) {
    return res.status(400).json({ error: 'Invalid status value' });
  }

  // auto-fill dates when status is advanced and no explicit date was sent
  const today = new Date().toISOString().slice(0, 10);
  if (update.status === 'Disseminated to Region' && !update.date_disseminated_to_region) {
    update.date_disseminated_to_region = today;
  }
  if (update.status === 'Received from Region') {
    if (!update.date_disseminated_to_region) update.date_disseminated_to_region = today;
    if (!update.date_received) update.date_received = today;
  }
  if (update.status === 'Still in the Office') {
    update.date_disseminated_to_region = null;
    update.date_received = null;
  }

  const { data, error } = await supabase
    .from('travel_orders')
    .update(update)
    .eq('id', id)
    .select()
    .single();

  if (error) {
    if (error.code === '23505') {
      return res.status(409).json({ error: `TO number "${update.to_no}" is already used by another record.` });
    }
    return res.status(500).json({ error: error.message });
  }
  res.json(data);
});

// ---------- DELETE a travel order ----------
app.delete('/api/travel-orders/:id', async (req, res) => {
  const { id } = req.params;
  const { error } = await supabase.from('travel_orders').delete().eq('id', id);
  if (error) return res.status(500).json({ error: error.message });
  res.status(204).send();
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Travel Order Tracker running on port ${PORT}`));