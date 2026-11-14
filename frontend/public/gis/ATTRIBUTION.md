# Natural Earth reference geometry

Made with Natural Earth. Free vector and raster map data at https://www.naturalearthdata.com/.

Natural Earth data is in the public domain. Its terms permit modification and commercial use:
https://www.naturalearthdata.com/about/terms-of-use/.

Retained source datasets, from the repository maintained by Natural Earth coauthor Nathaniel Vaughn Kelso:

- Land: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_land.geojson
- Country polygons: https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/ne_110m_admin_0_countries.geojson

Additional boundary datasets used by the board map components (轮廓地图 / 瓦片地图):

- China provinces: DataV.GeoJSON (阿里云 DataV 地理数据, https://geo.datav.aliyun.com/areas_v3/bound/100000_full.json).
  仅供演示参考, 边界数据以官方标准地图为准: http://bzdt.ch.mnr.gov.cn/.
- US states: PublicaMundi MappingAPI sample data (originally US Census Bureau cartographic boundaries),
  https://raw.githubusercontent.com/PublicaMundi/MappingAPI/master/data/geojson/us-states.json.

The local GIS assets render these source polygon rings and an equirectangular reference grid as
thin meshes. They preserve the source dataset's boundaries and make no independent boundary claims.
They are reference geometry for scene composition, not a surveyed map or a full GIS tile engine.
