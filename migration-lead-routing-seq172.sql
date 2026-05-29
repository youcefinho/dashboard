CREATE TABLE lead_routing_scores (
  agent_id TEXT,
  lead_category TEXT,
  score REAL,
  PRIMARY KEY(agent_id, lead_category)
);
