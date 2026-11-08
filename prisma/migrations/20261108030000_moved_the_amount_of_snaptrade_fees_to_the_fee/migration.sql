-- The fees of SnapTrade were imported with the amount as unit price, which
-- Ghostfolio does not count as fee
UPDATE "Order"
SET "fee" = "quantity" * "unitPrice", "quantity" = 0, "unitPrice" = 0
WHERE "type" = 'FEE'
  AND "fee" = 0
  AND "unitPrice" > 0
  AND "comment" LIKE 'SnapTrade%';
