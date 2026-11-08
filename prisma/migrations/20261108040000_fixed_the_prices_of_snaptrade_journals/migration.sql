-- The positions which SnapTrade journals between the CAD and the USD listing
-- of a security (e.g. DLR and DLR.U) were imported with wrong prices, as the
-- book value is in the currency of the incoming position: "JOURNAL POSITION
-- FROM CAD BOOK VALUE: $1313.07 CNV@ 1.3951" is 1,313.07 USD at 1.3951 CAD
-- per USD

-- The incoming position at the book value
UPDATE "Order" AS o
SET "unitPrice" = journal."bookValue" / o."quantity"
FROM (
  SELECT
    "id",
    replace(
      (regexp_match("comment", 'BOOK VALUE:?\s*\$?\s*([0-9,]+(?:\.[0-9]+)?)', 'i'))[1],
      ',',
      ''
    )::DOUBLE PRECISION AS "bookValue"
  FROM "Order"
  WHERE "type" = 'BUY'
    AND "comment" LIKE 'SnapTrade:%JOURNAL POSITION FROM%BOOK VALUE%'
) AS journal
WHERE o."id" = journal."id"
  AND journal."bookValue" > 0
  AND o."quantity" > 0;

-- The outgoing position at the book value in its currency
UPDATE "Order" AS o
SET "unitPrice" = CASE
  WHEN incoming."currency" = 'USD' AND COALESCE(o."currency", outgoingProfile."currency") = 'CAD'
    THEN incoming."bookValue" * incoming."rate" / o."quantity"
  WHEN incoming."currency" = 'CAD' AND COALESCE(o."currency", outgoingProfile."currency") = 'USD'
    THEN incoming."bookValue" / incoming."rate" / o."quantity"
  ELSE o."unitPrice"
END
FROM
  "SymbolProfile" AS outgoingProfile,
  (
    SELECT
      i."accountId",
      COALESCE(i."currency", p."currency") AS "currency",
      i."date"::DATE AS "day",
      i."quantity",
      i."userId",
      replace(
        (regexp_match(i."comment", 'BOOK VALUE:?\s*\$?\s*([0-9,]+(?:\.[0-9]+)?)', 'i'))[1],
        ',',
        ''
      )::DOUBLE PRECISION AS "bookValue",
      (regexp_match(i."comment", 'CNV@\s*([0-9.]+)', 'i'))[1]::DOUBLE PRECISION AS "rate"
    FROM "Order" AS i
    JOIN "SymbolProfile" AS p ON p."id" = i."symbolProfileId"
    WHERE i."type" = 'BUY'
      AND i."comment" LIKE 'SnapTrade:%JOURNAL POSITION FROM%BOOK VALUE%'
  ) AS incoming
WHERE outgoingProfile."id" = o."symbolProfileId"
  AND o."type" = 'SELL'
  AND o."comment" LIKE 'SnapTrade:%JOURNAL POSITION TO%'
  AND o."accountId" = incoming."accountId"
  AND o."userId" = incoming."userId"
  AND o."date"::DATE = incoming."day"
  AND o."quantity" = incoming."quantity"
  AND incoming."bookValue" > 0
  AND incoming."rate" > 0
  AND o."quantity" > 0;
