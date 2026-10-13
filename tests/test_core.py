from nyan.bot import discover_extensions


async def test_db_roundtrip(db):
    await db.executescript("CREATE TABLE IF NOT EXISTS t (k TEXT PRIMARY KEY, v INTEGER);")
    assert await db.execute("INSERT INTO t VALUES (?, ?)", ("a", 1)) == 1
    row = await db.fetchone("SELECT v FROM t WHERE k = ?", ("a",))
    assert row["v"] == 1


def test_core_extension_discovered():
    assert "nyan.cogs.core" in discover_extensions()
