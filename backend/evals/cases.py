# Evaluation cases: (table, question, gold SQL, ordered?)
# `ordered` = the question implies a ranking, so row order must match.
#
# CASES is the tuning set: prompt changes were made while looking at its
# failures. HELDOUT was written before those changes and never tuned
# against — it's the honest check that a change generalises. Keep it that
# way: when a held-out question fails, fix the pipeline, then move the case
# into CASES and write a fresh held-out one.
CASES = [
    # ── sales_data ──
    ("sales_data", "Show total revenue by region",
     "SELECT region, SUM(total_revenue) FROM sales_data GROUP BY region", False),
    ("sales_data", "How many orders were cancelled?",
     "SELECT COUNT(*) FROM sales_data WHERE status = 'Cancelled'", False),
    ("sales_data", "how many cancelled orders are there",
     "SELECT COUNT(*) FROM sales_data WHERE status = 'Cancelled'", False),
    ("sales_data", "Top 5 products by revenue",
     "SELECT product, SUM(total_revenue) AS r FROM sales_data GROUP BY product ORDER BY r DESC LIMIT 5", True),
    ("sales_data", "What is the average order value?",
     "SELECT AVG(total_revenue) FROM sales_data", False),
    ("sales_data", "Total revenue per month in 2024",
     "SELECT strftime('%Y-%m', order_date) AS m, SUM(total_revenue) FROM sales_data WHERE order_date LIKE '2024%' GROUP BY m ORDER BY m", False),
    # "The most phones" means units; asking would be over-asking (see CLARIFY).
    ("sales_data", "Which region sold the most phones?",
     "SELECT region FROM sales_data WHERE product = 'Phone' GROUP BY region ORDER BY SUM(quantity) DESC LIMIT 1", True),
    ("sales_data", "Show orders from the north region",
     "SELECT * FROM sales_data WHERE region = 'North'", False),
    ("sales_data", "List all products available in the Electronics category",
     "SELECT DISTINCT product FROM sales_data WHERE category = 'Electronics'", False),
    ("sales_data", "Describe revenue by category",
     "SELECT category, SUM(total_revenue) FROM sales_data GROUP BY category", False),
    ("sales_data", "What were total sales in October 2024?",
     "SELECT SUM(total_revenue) FROM sales_data WHERE order_date BETWEEN '2024-10-01' AND '2024-10-31'", False),
    ("sales_data", "How many orders does each status have?",
     "SELECT status, COUNT(*) FROM sales_data GROUP BY status", False),
    ("sales_data", "Which customers spent more than 5000 in total?",
     "SELECT customer_name FROM sales_data GROUP BY customer_name HAVING SUM(total_revenue) > 5000", False),
    ("sales_data", "Show the 10 most recent orders",
     "SELECT order_id FROM sales_data ORDER BY order_date DESC, order_id LIMIT 10", False),
    ("sales_data", "Average quantity per order for each category",
     "SELECT category, AVG(quantity) FROM sales_data GROUP BY category", False),
    # Moved from HELDOUT after its failure shaped the fix_date_like guard.
    ("sales_data", "Number of orders per month in 2024",
     "SELECT strftime('%Y-%m', order_date) AS m, COUNT(*) FROM sales_data WHERE order_date LIKE '2024%' GROUP BY m", False),
    ("sales_data", "What percentage of orders were completed?",
     "SELECT 100.0 * SUM(status = 'Completed') / COUNT(*) FROM sales_data", False),

    # ── customers ──
    ("customers", "How many customers are in each tier?",
     "SELECT tier, COUNT(*) FROM customers GROUP BY tier", False),
    ("customers", "Top 10 customers by lifetime value",
     "SELECT name FROM customers ORDER BY lifetime_value DESC LIMIT 10", True),
    ("customers", "Which country has the most customers?",
     "SELECT country FROM customers GROUP BY country ORDER BY COUNT(*) DESC LIMIT 1", True),
    ("customers", "How many customers signed up in 2023?",
     "SELECT COUNT(*) FROM customers WHERE signup_date LIKE '2023%'", False),
    ("customers", "Average lifetime value of gold tier customers",
     "SELECT AVG(lifetime_value) FROM customers WHERE tier = 'Gold'", False),
    ("customers", "List customers from germany",
     "SELECT name FROM customers WHERE country = 'Germany'", False),

    # ── global_water_access ──
    ("global_water_access", "Which countries have water access below 60%?",
     "SELECT country FROM global_water_access WHERE water_access_pct < 60", False),
    ("global_water_access", "Average water access by region",
     "SELECT region, AVG(water_access_pct) FROM global_water_access GROUP BY region", False),
    ("global_water_access", "Top 5 most populous countries",
     "SELECT country FROM global_water_access ORDER BY population DESC LIMIT 5", True),
    ("global_water_access", "Which African countries have sanitation access above 80 percent?",
     "SELECT country FROM global_water_access WHERE region = 'Africa' AND sanitation_access_pct > 80", False),
    ("global_water_access", "What is the total population of Europe?",
     "SELECT SUM(population) FROM global_water_access WHERE region = 'Europe'", False),
    ("global_water_access", "Countries where clean water is available to less than half the population",
     "SELECT country FROM global_water_access WHERE water_access_pct < 50", False),

    # ── sampledata (prices stored as TEXT) ──
    ("sampledata", "Which product has the highest sale price?",
     "SELECT product FROM sampledata ORDER BY CAST(sale_price AS REAL) DESC LIMIT 1", True),
    ("sampledata", "Show the 3 cheapest products by cost price",
     "SELECT product FROM sampledata ORDER BY CAST(cost_price AS REAL) ASC LIMIT 3", True),
    ("sampledata", "What is the profit for each product?",
     "SELECT product, CAST(sale_price AS REAL) - CAST(cost_price AS REAL) FROM sampledata", False),
]

HELDOUT = [
    ("sales_data", "Which category brought in the most revenue?",
     "SELECT category FROM sales_data GROUP BY category ORDER BY SUM(total_revenue) DESC LIMIT 1", True),
    ("sales_data", "Average unit price of products in the Clothing category",
     "SELECT AVG(unit_price) FROM sales_data WHERE category = 'Clothing'", False),
    ("sales_data", "How many distinct customers placed orders?",
     "SELECT COUNT(DISTINCT customer_name) FROM sales_data", False),
    ("sales_data", "How many orders were placed in each region in December 2024?",
     "SELECT region, COUNT(*) FROM sales_data WHERE order_date LIKE '2024-12%' GROUP BY region", False),
    ("sales_data", "List the products sold in the South region",
     "SELECT DISTINCT product FROM sales_data WHERE region = 'South'", False),
    ("sales_data", "Which product had the highest total quantity sold?",
     "SELECT product FROM sales_data GROUP BY product ORDER BY SUM(quantity) DESC LIMIT 1", True),
    ("customers", "Which tier has the highest average lifetime value?",
     "SELECT tier FROM customers GROUP BY tier ORDER BY AVG(lifetime_value) DESC LIMIT 1", True),
    ("customers", "How many customers signed up each year?",
     "SELECT strftime('%Y', signup_date) AS y, COUNT(*) FROM customers GROUP BY y", False),
    ("customers", "Show the 5 customers with the most orders",
     "SELECT name FROM customers ORDER BY total_orders DESC, customer_id LIMIT 5", False),
    ("global_water_access", "Which region has the lowest average sanitation access?",
     "SELECT region FROM global_water_access GROUP BY region ORDER BY AVG(sanitation_access_pct) ASC LIMIT 1", True),
    ("global_water_access", "How many countries are in each region?",
     "SELECT region, COUNT(*) FROM global_water_access GROUP BY region", False),
    ("global_water_access", "List European countries with water access above 95%",
     "SELECT country FROM global_water_access WHERE region = 'Europe' AND water_access_pct > 95", False),
]

# ── Phase 2: vague questions ────────────────────────────────────────────────
# Vague time words resolve against the latest date in the data, not today
# (sales_data runs 2024-01-01 .. 2024-12-27). Same format as CASES.
DEFAULTS = [
    ("sales_data", "What was the revenue in the most recent month?",
     "SELECT SUM(total_revenue) FROM sales_data WHERE order_date LIKE '2024-12%'", False),
    ("sales_data", "Total revenue over the last 3 months",
     "SELECT SUM(total_revenue) FROM sales_data WHERE order_date >= '2024-10-01'", False),
    ("sales_data", "Show the latest 5 orders",
     "SELECT order_id FROM sales_data ORDER BY order_date DESC LIMIT 5", False),
    ("sales_data", "How many orders were placed this year?",
     "SELECT COUNT(*) FROM sales_data WHERE order_date LIKE '2024%'", False),
    ("customers", "Top customers by lifetime value",
     "SELECT name FROM customers ORDER BY lifetime_value DESC LIMIT 10", True),
]

# Genuinely ambiguous: readings give different answers. Correct = Prism asks
# a clarifying question with at least two options instead of guessing.
CLARIFY = [
    ("sales_data", "Which region performs best?"),              # revenue, orders, quantity?
    ("customers", "Who are our best customers?"),              # lifetime value or orders
    ("sales_data", "Show me the best products"),               # revenue or quantity
    ("global_water_access", "Which countries are doing best?"),  # water or sanitation
    ("sales_data", "Compare the regions"),                      # by revenue, orders, quantity?
    ("sales_data", "How are we doing?"),                        # no metric at all
]

# (table, first question, follow-up, gold SQL for the follow-up, ordered?)
# The follow-up is asked with the first question and its SQL as context.
FOLLOWUPS = [
    ("sales_data", "Show total revenue by region", "Now only for Electronics",
     "SELECT region, SUM(total_revenue) FROM sales_data WHERE category = 'Electronics' GROUP BY region", False),
    ("sales_data", "How many orders were cancelled?", "What about completed ones?",
     "SELECT COUNT(*) FROM sales_data WHERE status = 'Completed'", False),
    ("customers", "Top 10 customers by lifetime value", "Only Gold tier",
     "SELECT name FROM customers WHERE tier = 'Gold' ORDER BY lifetime_value DESC LIMIT 10", True),
    ("global_water_access", "Average water access by region", "Use sanitation access instead",
     "SELECT region, AVG(sanitation_access_pct) FROM global_water_access GROUP BY region", False),
    ("sales_data", "Total revenue per month in 2024", "Just the North region",
     "SELECT strftime('%Y-%m', order_date) AS m, SUM(total_revenue) FROM sales_data "
     "WHERE region = 'North' GROUP BY m", False),
    ("global_water_access", "Which countries have water access below 60%?", "And sanitation below 50% as well",
     "SELECT country FROM global_water_access WHERE water_access_pct < 60 AND sanitation_access_pct < 50", False),
]

# Written after the ambiguity trigger (nl2sql.looks_ambiguous) was designed
# against CLARIFY, as a fresher check. The author knew the trigger's word
# list, so treat these as weaker evidence than HELDOUT.
CLARIFY_HELDOUT = [
    ("global_water_access", "Which region is doing worst?"),
    ("customers", "Show our top customers"),
    ("sales_data", "What are our strongest categories?"),
    ("customers", "Compare the tiers"),
]

# Evaluative words, but the measure is named: these must be answered, not asked.
CLEAR_EVALUATIVE = [
    ("sales_data", "Top 3 regions by quantity sold",
     "SELECT region FROM sales_data GROUP BY region ORDER BY SUM(quantity) DESC LIMIT 3", True),
    ("global_water_access", "Which region has the best sanitation access on average?",
     "SELECT region FROM global_water_access GROUP BY region ORDER BY AVG(sanitation_access_pct) DESC LIMIT 1", True),
    ("customers", "Compare tiers by average lifetime value",
     "SELECT tier, AVG(lifetime_value) FROM customers GROUP BY tier", False),
]
