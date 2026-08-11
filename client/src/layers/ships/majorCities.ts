// Major world cities for the fleet snapshot's "nearest major city" context:
// national capitals, cities of 250k+ population, and first-order admin seats
// of 25k+ — worldwide, so every ship position resolves to a recognizable
// anchor no matter where the fleet is sailing.
//
// GENERATED FILE — do not hand-edit. Source: GeoNames "cities15000" via the
// all-the-cities@3.1.0 npm package (data CC BY 4.0, geonames.org — credited
// on the rendered snapshot). Row format: name \t region \t lat \t lon,
// where region is the US state / Canadian province postal abbreviation or the
// English country name, and coordinates are degrees rounded to 0.01°.
// Regenerate with client/scripts/generate-major-cities.mjs (see its header
// for the one-line invocation).

export interface MajorCity {
  name: string;
  region: string; // "WA" / "BC" / "French Polynesia"
  lat: number;
  lon: number;
}

export interface NearestCity {
  city: MajorCity;
  distNm: number; // great-circle distance, nautical miles
  bearingDeg: number; // initial bearing from the city toward the query point
}

const ROWS = `Calgary	AB	51.05	-114.09
Edmonton	AB	53.55	-113.47
Aībak	Afghanistan	36.26	68.02
Asadābād	Afghanistan	34.87	71.15
Bāmyān	Afghanistan	34.82	67.83
Bāzārak	Afghanistan	35.31	69.52
Charikar	Afghanistan	35.01	69.17
Farah	Afghanistan	32.37	62.12
Fayzabad	Afghanistan	37.12	70.58
Gardez	Afghanistan	33.60	69.23
Ghazni	Afghanistan	33.55	68.42
Herāt	Afghanistan	34.35	62.20
Jalālābād	Afghanistan	34.43	70.45
Kabul	Afghanistan	34.53	69.17
Kandahār	Afghanistan	31.61	65.71
Khōst	Afghanistan	33.34	69.92
Kunduz	Afghanistan	36.73	68.86
Lashkar Gāh	Afghanistan	31.59	64.37
Maymana	Afghanistan	35.92	64.78
Mazār-e Sharīf	Afghanistan	36.71	67.11
Pul-e Khumrī	Afghanistan	35.94	68.72
Sar-e Pul	Afghanistan	36.22	65.93
Shibirghān	Afghanistan	36.67	65.75
Taloqan	Afghanistan	36.74	69.53
Zaranj	Afghanistan	30.96	61.86
Anchorage	AK	61.22	-149.90
Juneau	AK	58.30	-134.42
Mariehamn	Åland Islands	60.10	19.93
Berat	Albania	40.71	19.95
Durrës	Albania	41.32	19.45
Elbasan	Albania	41.11	20.08
Fier	Albania	40.72	19.56
Korçë	Albania	40.62	20.78
Shkodër	Albania	42.07	19.51
Tirana	Albania	41.33	19.82
Vlorë	Albania	40.47	19.48
Adrar	Algeria	27.87	-0.29
Aïn Defla	Algeria	36.26	1.97
Aïn Temouchent	Algeria	35.30	-1.14
Algiers	Algeria	36.73	3.09
Annaba	Algeria	36.90	7.77
Bab Ezzouar	Algeria	36.73	3.18
Batna	Algeria	35.56	6.17
Béchar	Algeria	31.62	-2.22
Bejaïa	Algeria	36.76	5.08
Biskra	Algeria	34.85	5.73
Blida	Algeria	36.47	2.83
Bordj Bou Arreridj	Algeria	36.07	4.76
Bouïra	Algeria	36.37	3.90
Boumerdas	Algeria	36.77	3.48
Chlef	Algeria	36.17	1.33
Constantine	Algeria	36.37	6.61
Djelfa	Algeria	34.67	3.26
El Bayadh	Algeria	33.68	1.02
El Oued	Algeria	33.36	6.86
Ghardaïa	Algeria	32.49	3.67
Guelma	Algeria	36.46	7.43
Jijel	Algeria	36.82	5.76
Khenchela	Algeria	35.44	7.14
Laghouat	Algeria	33.80	2.87
M’Sila	Algeria	35.71	4.54
Mascara	Algeria	35.40	0.14
Médéa	Algeria	36.26	2.75
Mila	Algeria	36.45	6.26
Mostaganem	Algeria	35.93	0.09
Oran	Algeria	35.70	-0.64
Ouargla	Algeria	31.95	5.33
Oum el Bouaghi	Algeria	35.88	7.11
Relizane	Algeria	35.74	0.56
Saïda	Algeria	34.83	0.15
Sétif	Algeria	36.19	5.41
Sidi Bel Abbès	Algeria	35.19	-0.63
Skikda	Algeria	36.88	6.91
Souk Ahras	Algeria	36.29	7.95
Tamanrasset	Algeria	22.79	5.52
Tébessa	Algeria	35.40	8.12
Tiaret	Algeria	35.37	1.32
Tindouf	Algeria	27.67	-8.15
Tipasa	Algeria	36.59	2.45
Tissemsilt	Algeria	35.61	1.81
Tizi Ouzou	Algeria	36.71	4.05
Tlemcen	Algeria	34.88	-1.31
Montgomery	AL	32.37	-86.30
Pago Pago	American Samoa	-14.28	-170.70
Andorra la Vella	Andorra	42.51	1.52
Benguela	Angola	-12.58	13.41
Cabinda	Angola	-5.55	12.20
Caxito	Angola	-8.58	13.66
Cuito	Angola	-12.38	16.93
Huambo	Angola	-12.78	15.74
Luanda	Angola	-8.84	13.23
Lubango	Angola	-14.92	13.49
Malanje	Angola	-9.54	16.34
Menongue	Angola	-14.66	17.69
N’dalatando	Angola	-9.30	14.91
Namibe	Angola	-15.20	12.15
Saurimo	Angola	-9.66	20.39
Sumbe	Angola	-11.21	13.84
Uíge	Angola	-7.61	15.06
The Valley	Anguilla	18.22	-63.06
Saint John’s	Antigua & Barbuda	17.12	-61.84
Bahía Blanca	Argentina	-38.72	-62.27
Buenos Aires	Argentina	-34.61	-58.38
Córdoba	Argentina	-31.41	-64.18
Corrientes	Argentina	-27.47	-58.83
Formosa	Argentina	-26.18	-58.17
La Plata	Argentina	-34.92	-57.95
La Rioja	Argentina	-29.41	-66.85
Mar del Plata	Argentina	-38.00	-57.56
Mendoza	Argentina	-32.89	-68.83
Morón	Argentina	-34.65	-58.62
Neuquén	Argentina	-38.95	-68.06
Paraná	Argentina	-31.73	-60.53
Posadas	Argentina	-27.37	-55.90
Rawson	Argentina	-43.30	-65.10
Resistencia	Argentina	-27.46	-58.98
Río Gallegos	Argentina	-51.62	-69.22
Rosario	Argentina	-32.95	-60.64
Salta	Argentina	-24.79	-65.41
San Fernando del Valle de Catamarca	Argentina	-28.47	-65.79
San Juan	Argentina	-31.54	-68.54
San Luis	Argentina	-33.30	-66.34
San Miguel de Tucumán	Argentina	-26.82	-65.22
San Salvador de Jujuy	Argentina	-24.19	-65.30
Santa Fe	Argentina	-31.65	-60.71
Santa Rosa	Argentina	-36.62	-64.28
Santiago del Estero	Argentina	-27.80	-64.26
Ushuaia	Argentina	-54.81	-68.32
Viedma	Argentina	-40.81	-63.00
Little Rock	AR	34.75	-92.29
Armavir	Armenia	40.15	44.04
Gyumri	Armenia	40.79	43.85
Hrazdan	Armenia	40.50	44.77
Kapan	Armenia	39.21	46.41
Vanadzor	Armenia	40.80	44.49
Yerevan	Armenia	40.18	44.51
Oranjestad	Aruba	12.52	-70.03
Adelaide	Australia	-34.93	138.60
Brisbane	Australia	-27.47	153.03
Canberra	Australia	-35.28	149.13
Darwin	Australia	-12.46	130.84
Gold Coast	Australia	-28.00	153.43
Hobart	Australia	-42.88	147.33
Logan City	Australia	-27.64	153.11
Melbourne	Australia	-37.81	144.96
Newcastle	Australia	-32.93	151.78
Perth	Australia	-31.95	115.86
Sydney	Australia	-33.87	151.21
Wollongong	Australia	-34.42	150.89
Bregenz	Austria	47.50	9.75
Graz	Austria	47.07	15.45
Innsbruck	Austria	47.26	11.39
Klagenfurt am Wörthersee	Austria	46.62	14.31
Linz	Austria	48.31	14.29
Salzburg	Austria	47.80	13.04
Vienna	Austria	48.21	16.37
Chandler	AZ	33.31	-111.84
Ağdam	Azerbaijan	39.99	46.93
Agdzhabedy	Azerbaijan	40.05	47.46
Baku	Azerbaijan	40.38	49.89
Barda	Azerbaijan	40.38	47.13
Fizuli	Azerbaijan	39.60	47.15
Ganja	Azerbaijan	40.68	46.36
Geoktschai	Azerbaijan	40.65	47.74
Imishli	Azerbaijan	39.87	48.06
Jalilabad	Azerbaijan	39.21	48.49
Khirdalan	Azerbaijan	40.45	49.76
Lankaran	Azerbaijan	38.75	48.85
Mingelchaur	Azerbaijan	40.76	47.06
Nakhchivan	Azerbaijan	39.21	45.41
Saatlı	Azerbaijan	39.93	48.37
Sabirabad	Azerbaijan	40.01	48.48
Salyan	Azerbaijan	39.60	48.98
Shamakhi	Azerbaijan	40.63	48.64
Shamkhor	Azerbaijan	40.83	46.02
Sheki	Azerbaijan	41.19	47.17
Şirvan	Azerbaijan	39.94	48.93
Sumqayıt	Azerbaijan	40.59	49.67
Xaçmaz	Azerbaijan	41.46	48.81
Yevlakh	Azerbaijan	40.62	47.15
Mesa	AZ	33.42	-111.82
Phoenix	AZ	33.45	-112.07
Tucson	AZ	32.22	-110.93
Freeport	Bahamas	26.53	-78.70
Nassau	Bahamas	25.06	-77.34
Manama	Bahrain	26.23	50.59
Bagerhat	Bangladesh	22.66	89.79
Barisāl	Bangladesh	22.70	90.37
Chittagong	Bangladesh	22.34	91.83
Comilla	Bangladesh	23.46	91.19
Cox’s Bāzār	Bangladesh	21.44	92.01
Dhaka	Bangladesh	23.71	90.41
Khulna	Bangladesh	22.81	89.56
Mymensingh	Bangladesh	24.76	90.41
Narsingdi	Bangladesh	23.92	90.72
Natore	Bangladesh	24.41	88.99
Rājshāhi	Bangladesh	24.37	88.60
Rangpur	Bangladesh	25.75	89.25
Shibganj	Bangladesh	25.00	89.32
Sylhet	Bangladesh	24.90	91.87
Tungi	Bangladesh	23.89	90.40
Bridgetown	Barbados	13.11	-59.62
Okanagan	BC	50.36	-119.35
Surrey	BC	49.11	-122.83
Vancouver	BC	49.25	-123.12
Victoria	BC	48.44	-123.35
Brest	Belarus	52.10	23.69
Homyel'	Belarus	52.43	30.98
Hrodna	Belarus	53.69	23.83
Mahilyow	Belarus	53.92	30.34
Minsk	Belarus	53.90	27.57
Vitebsk	Belarus	55.19	30.20
Antwerpen	Belgium	51.22	4.40
Brussels	Belgium	50.85	4.35
Namur	Belgium	50.47	4.87
Belize City	Belize	17.50	-88.20
Belmopan	Belize	17.25	-88.77
Abomey	Benin	7.18	1.99
Abomey-Calavi	Benin	6.45	2.36
Cotonou	Benin	6.37	2.42
Djougou	Benin	9.71	1.67
Dogbo	Benin	6.80	1.78
Kandi	Benin	11.13	2.94
Lokossa	Benin	6.64	1.72
Natitingou	Benin	10.30	1.38
Ouidah	Benin	6.36	2.09
Parakou	Benin	9.34	2.63
Porto-Novo	Benin	6.50	2.60
Sakété	Benin	6.74	2.66
Savalou	Benin	7.93	1.98
Hamilton	Bermuda	32.29	-64.78
Thimphu	Bhutan	27.47	89.64
Cobija	Bolivia	-11.03	-68.77
Cochabamba	Bolivia	-17.39	-66.16
La Paz	Bolivia	-16.50	-68.15
Oruro	Bolivia	-17.98	-67.15
Potosí	Bolivia	-19.58	-65.75
Santa Cruz de la Sierra	Bolivia	-17.79	-63.18
Sucre	Bolivia	-19.03	-65.26
Tarija	Bolivia	-21.54	-64.73
Trinidad	Bolivia	-14.83	-64.90
Banja Luka	Bosnia & Herzegovina	44.78	17.19
Brčko	Bosnia & Herzegovina	44.87	18.81
Sarajevo	Bosnia & Herzegovina	43.85	18.36
Francistown	Botswana	-21.17	27.51
Gaborone	Botswana	-24.65	25.91
Kanye	Botswana	-24.97	25.33
Maun	Botswana	-19.98	23.42
Mochudi	Botswana	-24.42	26.15
Molepolole	Botswana	-24.41	25.50
Serowe	Botswana	-22.39	26.71
Ananindeua	Brazil	-1.37	-48.37
Anápolis	Brazil	-16.33	-48.95
Aparecida de Goiânia	Brazil	-16.82	-49.24
Aracaju	Brazil	-10.91	-37.07
Barueri	Brazil	-23.51	-46.88
Bauru	Brazil	-22.31	-49.06
Belém	Brazil	-1.46	-48.50
Belford Roxo	Brazil	-22.76	-43.40
Belo Horizonte	Brazil	-19.92	-43.94
Betim	Brazil	-19.97	-44.20
Blumenau	Brazil	-26.92	-49.07
Boa Vista	Brazil	2.82	-60.67
Brasília	Brazil	-15.78	-47.93
Campina Grande	Brazil	-7.23	-35.88
Campinas	Brazil	-22.91	-47.06
Campo Grande	Brazil	-20.44	-54.65
Campos dos Goytacazes	Brazil	-21.75	-41.33
Canoas	Brazil	-29.92	-51.18
Carapicuíba	Brazil	-23.52	-46.84
Cascavel	Brazil	-24.96	-53.46
Caucaia	Brazil	-3.74	-38.65
Caxias do Sul	Brazil	-29.17	-51.18
Contagem	Brazil	-19.93	-44.05
Cuiabá	Brazil	-15.60	-56.10
Curitiba	Brazil	-25.43	-49.27
Diadema	Brazil	-23.69	-46.62
Duque de Caxias	Brazil	-22.79	-43.31
Feira de Santana	Brazil	-12.27	-38.97
Florianópolis	Brazil	-27.60	-48.55
Fortaleza	Brazil	-3.72	-38.54
Foz do Iguaçu	Brazil	-25.55	-54.59
Franca	Brazil	-20.54	-47.40
Goiânia	Brazil	-16.68	-49.25
Governador Valadares	Brazil	-18.85	-41.95
Guarujá	Brazil	-23.99	-46.26
Guarulhos	Brazil	-23.46	-46.53
Itaquaquecetuba	Brazil	-23.49	-46.35
Jaboatão	Brazil	-8.18	-35.00
Jaboatão dos Guararapes	Brazil	-8.11	-35.01
João Pessoa	Brazil	-7.12	-34.86
Joinville	Brazil	-26.30	-48.85
Juiz de Fora	Brazil	-21.76	-43.35
Jundiaí	Brazil	-23.19	-46.88
Limeira	Brazil	-22.56	-47.40
Londrina	Brazil	-23.31	-51.16
Macapá	Brazil	0.04	-51.07
Maceió	Brazil	-9.67	-35.74
Manaus	Brazil	-3.10	-60.02
Maringá	Brazil	-23.43	-51.94
Mauá	Brazil	-23.67	-46.46
Mogi das Cruzes	Brazil	-23.52	-46.19
Montes Claros	Brazil	-16.73	-43.86
Natal	Brazil	-5.79	-35.21
Niterói	Brazil	-22.88	-43.10
Nova Iguaçu	Brazil	-22.76	-43.45
Novo Hamburgo	Brazil	-29.68	-51.13
Olinda	Brazil	-8.01	-34.86
Osasco	Brazil	-23.53	-46.79
Palmas	Brazil	-10.17	-48.33
Paulista	Brazil	-7.94	-34.87
Pelotas	Brazil	-31.77	-52.34
Petrópolis	Brazil	-22.50	-43.18
Piracicaba	Brazil	-22.73	-47.65
Ponta Grossa	Brazil	-25.09	-50.16
Porto Alegre	Brazil	-30.03	-51.23
Porto Velho	Brazil	-8.76	-63.90
Praia Grande	Brazil	-24.01	-46.40
Recife	Brazil	-8.05	-34.88
Ribeirão das Neves	Brazil	-19.77	-44.09
Ribeirão Preto	Brazil	-21.18	-47.81
Rio Branco	Brazil	-9.97	-67.81
Rio de Janeiro	Brazil	-22.91	-43.18
Salvador	Brazil	-12.97	-38.51
Santo André	Brazil	-23.66	-46.54
Santos	Brazil	-23.96	-46.33
São Bernardo do Campo	Brazil	-23.69	-46.56
São João de Meriti	Brazil	-22.80	-43.37
São José do Rio Preto	Brazil	-20.82	-49.38
São José dos Campos	Brazil	-23.18	-45.89
São Luís	Brazil	-2.53	-44.30
São Paulo	Brazil	-23.55	-46.64
São Vicente	Brazil	-23.96	-46.39
Serra	Brazil	-20.13	-40.31
Sorocaba	Brazil	-23.50	-47.46
Suzano	Brazil	-23.54	-46.31
Taubaté	Brazil	-23.03	-45.56
Teresina	Brazil	-5.09	-42.80
Uberaba	Brazil	-19.75	-47.93
Uberlândia	Brazil	-18.92	-48.28
Viamão	Brazil	-30.08	-51.02
Vila Velha	Brazil	-20.33	-40.29
Vitória	Brazil	-20.32	-40.34
Vitória da Conquista	Brazil	-14.87	-40.84
Road Town	British Virgin Islands	18.43	-64.62
Bandar Seri Begawan	Brunei	4.89	114.94
Kuala Belait	Brunei	4.58	114.23
Blagoevgrad	Bulgaria	42.02	23.10
Burgas	Bulgaria	42.51	27.47
Dobrich	Bulgaria	43.57	27.83
Gabrovo	Bulgaria	42.87	25.33
Haskovo	Bulgaria	41.93	25.56
Kardzhali	Bulgaria	41.65	25.37
Kyustendil	Bulgaria	42.28	22.69
Lovech	Bulgaria	43.13	24.72
Montana	Bulgaria	43.41	23.23
Pazardzhik	Bulgaria	42.20	24.33
Pernik	Bulgaria	42.60	23.03
Pleven	Bulgaria	43.42	24.62
Plovdiv	Bulgaria	42.15	24.75
Razgrad	Bulgaria	43.53	26.52
Ruse	Bulgaria	43.85	25.95
Shumen	Bulgaria	43.27	26.92
Silistra	Bulgaria	44.12	27.26
Sliven	Bulgaria	42.69	26.33
Smolyan	Bulgaria	41.57	24.71
Sofia	Bulgaria	42.70	23.32
Stara Zagora	Bulgaria	42.43	25.64
Targovishte	Bulgaria	43.25	26.57
Varna	Bulgaria	43.22	27.92
Veliko Tŭrnovo	Bulgaria	43.08	25.63
Vidin	Bulgaria	43.99	22.88
Vratsa	Bulgaria	43.21	23.56
Yambol	Bulgaria	42.48	26.50
Banfora	Burkina Faso	10.63	-4.77
Bobo-Dioulasso	Burkina Faso	11.18	-4.30
Dédougou	Burkina Faso	12.46	-3.46
Dori	Burkina Faso	14.04	-0.03
Fada N'gourma	Burkina Faso	12.06	0.36
Kaya	Burkina Faso	13.09	-1.08
Koudougou	Burkina Faso	12.25	-2.36
Ouagadougou	Burkina Faso	12.37	-1.53
Ouahigouya	Burkina Faso	13.58	-2.42
Tenkodogo	Burkina Faso	11.78	-0.37
Bujumbura	Burundi	-3.38	29.36
Gitega	Burundi	-3.43	29.92
Muyinga	Burundi	-2.85	30.34
Ruyigi	Burundi	-3.48	30.25
Anaheim	CA	33.84	-117.91
Bakersfield	CA	35.37	-119.02
Chula Vista	CA	32.64	-117.08
Fresno	CA	36.75	-119.77
Irvine	CA	33.67	-117.82
Long Beach	CA	33.77	-118.19
Los Angeles	CA	34.05	-118.24
Battambang	Cambodia	13.10	103.20
Kampong Cham	Cambodia	11.99	105.46
Kampong Chhnang	Cambodia	12.25	104.67
Kampong Speu	Cambodia	11.45	104.52
Koh Kong	Cambodia	11.62	102.98
Phnom Penh	Cambodia	11.56	104.92
Prey Veng	Cambodia	11.49	105.33
Pursat	Cambodia	12.54	103.92
Siem Reap	Cambodia	13.36	103.86
Sihanoukville	Cambodia	10.61	103.53
Stung Treng	Cambodia	13.53	105.97
Suong	Cambodia	11.91	105.66
Ta Khmau	Cambodia	11.48	104.95
Takeo	Cambodia	10.99	104.78
Bafoussam	Cameroon	5.48	10.42
Bamenda	Cameroon	5.96	10.15
Bertoua	Cameroon	4.58	13.68
Buea	Cameroon	4.15	9.24
Douala	Cameroon	4.05	9.70
Ébolowa	Cameroon	2.90	11.15
Garoua	Cameroon	9.30	13.40
Kousséri	Cameroon	12.08	15.03
Maroua	Cameroon	10.59	14.32
Mokolo	Cameroon	10.74	13.80
Ngaoundéré	Cameroon	7.33	13.58
Yaoundé	Cameroon	3.87	11.52
Oakland	CA	37.80	-122.27
Mindelo	Cape Verde	16.89	-24.98
Praia	Cape Verde	14.93	-23.51
Kralendijk	Caribbean Netherlands	12.15	-68.27
Riverside	CA	33.95	-117.40
Sacramento	CA	38.58	-121.49
San Diego	CA	32.72	-117.16
San Francisco	CA	37.77	-122.42
San Jose	CA	37.34	-121.89
Santa Ana	CA	33.75	-117.87
Stockton	CA	37.96	-121.29
George Town	Cayman Islands	19.29	-81.37
Bambari	Central African Republic	5.77	20.68
Bangui	Central African Republic	4.36	18.55
Berbérati	Central African Republic	4.26	15.79
Bimbo	Central African Republic	4.26	18.42
Bossangoa	Central African Republic	6.49	17.46
Bouar	Central African Republic	5.93	15.60
Bozoum	Central African Republic	6.32	16.38
Bria	Central African Republic	6.54	21.99
Kaga Bandoro	Central African Republic	6.99	19.19
Mbaïki	Central African Republic	3.87	17.99
Nola	Central African Republic	3.52	16.05
Sibut	Central African Republic	5.72	19.07
Abéché	Chad	13.83	20.83
Am Timan	Chad	11.03	20.28
Bongor	Chad	10.28	15.37
Koumra	Chad	8.91	17.55
Mongo	Chad	12.18	18.69
Moundou	Chad	8.57	16.08
N'Djamena	Chad	12.11	15.04
Pala	Chad	9.36	14.90
Sarh	Chad	9.14	18.39
Antofagasta	Chile	-23.65	-70.40
Arica	Chile	-18.47	-70.30
Chillán	Chile	-36.61	-72.10
Concepción	Chile	-36.83	-73.05
Copiapó	Chile	-27.37	-70.33
Coyhaique	Chile	-45.58	-72.07
Iquique	Chile	-20.21	-70.15
La Serena	Chile	-29.90	-71.25
Puente Alto	Chile	-33.61	-70.58
Puerto Montt	Chile	-41.47	-72.94
Punta Arenas	Chile	-53.15	-70.91
Rancagua	Chile	-34.17	-70.74
Santiago	Chile	-33.46	-70.65
Talca	Chile	-35.43	-71.66
Talcahuano	Chile	-36.72	-73.12
Temuco	Chile	-38.74	-72.60
Valdivia	Chile	-39.81	-73.25
Valparaíso	Chile	-33.04	-71.63
Viña del Mar	Chile	-33.02	-71.55
Aksu	China	41.18	80.28
Anqing	China	30.51	117.05
Anshan	China	41.12	122.99
Anshun	China	26.25	105.93
Anyang	China	36.10	114.38
Aral	China	40.54	81.27
Baicheng	China	45.61	122.82
Baoding	China	38.85	115.49
Baotou	China	40.58	110.02
Bayan Nur	China	40.74	107.39
Bei’an	China	48.27	126.60
Beihai	China	21.48	109.10
Beijing	China	39.91	116.40
Bengbu	China	32.94	117.36
Benxi	China	41.29	123.77
Cangzhou	China	38.32	116.87
Changchun	China	43.88	125.32
Changde	China	29.03	111.70
Changsha	China	28.20	112.97
Changshu City	China	31.65	120.74
Changzhi	China	35.21	111.74
Changzhou	China	31.77	119.95
Chaoyang	China	41.57	120.46
Chaozhou	China	23.65	116.62
Chengde	China	40.95	117.96
Chengdu	China	30.67	104.07
Chengzhong	China	30.94	113.55
Chifeng	China	42.27	118.96
Chongqing	China	29.56	106.55
Chuzhou	China	32.32	118.30
Dadonghai	China	18.22	109.51
Dadukou	China	26.55	101.71
Dalian	China	38.91	121.60
Dandong	China	40.13	124.39
Datong	China	40.09	113.29
Dezhou	China	37.45	116.31
Dongguan	China	23.02	113.75
Fenghuang	China	27.94	109.60
Foshan	China	23.03	113.13
Fushun	China	41.89	123.94
Fuxin	China	42.02	121.66
Fuzhou	China	26.06	119.31
Guangzhou	China	23.12	113.25
Guankou	China	28.16	113.63
Guilin	China	25.28	110.29
Guiyang	China	26.58	106.72
Guli	China	28.88	120.03
Haikou	China	20.05	110.34
Handan	China	36.60	114.47
Hangzhou	China	30.29	120.16
Harbin	China	45.75	126.65
Hefei	China	31.86	117.28
Hegang	China	47.35	130.30
Hengshui	China	37.73	115.70
Hengyang	China	26.89	112.62
Heze	China	35.24	115.47
Hohhot	China	40.81	111.65
Huai'an	China	33.59	119.02
Huaibei	China	33.97	116.79
Huainan	China	32.63	117.00
Huangshi	China	30.25	115.05
Huizhou	China	23.11	114.42
Hulan Ergi	China	47.20	123.63
Huocheng	China	44.05	80.87
Jiamusi	China	46.80	130.32
Jiangmen	China	22.58	113.08
Jianshui	China	24.28	101.22
Jiaojiang	China	28.70	121.47
Jiaozuo	China	35.24	113.23
Jiaxing	China	30.75	120.75
Jieyang	China	23.54	116.37
Jilin	China	43.85	126.56
Jinan	China	36.67	117.00
Jincheng	China	35.50	112.83
Jingdezhen	China	29.29	117.21
Jining	China	35.41	116.58
Jinzhou	China	41.11	121.14
Jiujiang	China	29.70	116.00
Jixi	China	45.30	130.96
Kaifeng	China	34.80	114.31
Karamay	China	45.58	84.89
Kashgar	China	39.47	75.99
Kunming	China	25.04	102.72
Kunshan	China	31.38	120.95
Langfang	China	39.51	116.69
Lanzhou	China	36.06	103.84
Laohekou	China	32.39	111.67
Lhasa	China	29.65	91.10
Lianshan	China	40.76	120.85
Liaoyang	China	41.27	123.17
Liaoyuan	China	42.90	125.14
Lijiang	China	26.87	100.22
Linyi	China	35.06	118.34
Liupanshui	China	26.59	104.83
Luancheng	China	37.88	114.65
Luohe	China	33.56	114.04
Luoyang	China	34.68	112.45
Luqiao	China	28.58	121.37
Mianyang	China	31.47	104.68
Mudanjiang	China	44.58	129.60
Nanchang	China	28.68	115.85
Nanchong	China	30.80	106.08
Nanjing	China	32.06	118.78
Nanning	China	22.82	108.32
Nantong	China	32.03	120.87
Nanyang	China	32.99	112.53
Neijiang	China	29.58	105.06
Ningbo	China	29.88	121.55
Ordos	China	39.61	109.78
Panshan	China	41.19	122.05
Pingdingshan	China	33.74	113.30
Pingxiang	China	27.62	113.85
Putian	China	25.44	119.01
Puyang	China	29.46	119.89
Puyang Chengguanzhen	China	35.71	115.01
Qingdao	China	36.06	120.38
Qinhuangdao	China	39.93	119.59
Qionghai	China	19.24	110.46
Qiqihar	China	47.34	123.96
Shanghai	China	31.22	121.46
Shangrao	China	28.45	117.94
Shangyu	China	30.02	120.87
Shantou	China	23.37	116.71
Shaoguan	China	24.80	113.58
Shaoxing	China	30.00	120.58
Shashi	China	30.31	112.24
Shengli	China	37.46	118.49
Shenyang	China	41.79	123.43
Shenzhen	China	22.55	114.07
Shihezi	China	44.30	86.04
Shijiazhuang	China	38.04	114.48
Shiqi	China	22.52	113.39
Shiyan	China	32.65	110.78
Shuangyashan	China	46.64	131.15
Siping	China	43.16	124.38
Suihua	China	46.64	127.00
Suizhou	China	31.71	113.36
Suzhou	China	31.30	120.60
Tai’an	China	36.19	117.12
Taihecun	China	45.76	130.85
Taiyuan	China	37.87	112.56
Taizhou	China	32.49	119.91
Tanggu	China	39.02	117.65
Tangshan	China	39.63	118.18
Tianjin	China	39.14	117.18
Tianshui	China	34.58	105.74
Tieling	China	42.29	123.84
Tonghua	China	41.72	125.93
Tongliao	China	43.61	122.27
Tongshan	China	34.18	117.16
Turpan	China	42.95	89.18
Ürümqi	China	43.80	87.60
Wafangdian	China	39.62	122.01
Weifang	China	36.71	119.10
Wenshan City	China	23.36	104.25
Wenzhou	China	28.00	120.67
Wuhan	China	30.58	114.27
Wuhu	China	31.34	118.37
Wusong	China	30.95	117.78
Wuwei	China	37.93	102.63
Wuxi	China	31.57	120.29
Wuzhou	China	23.48	111.32
Xi’an	China	34.26	108.93
Xiamen	China	24.48	118.08
Xiangtan	China	27.85	112.90
Xiangyang	China	32.04	112.14
Xianyang	China	34.34	108.70
Xingtai	China	37.06	114.49
Xining	China	36.63	101.76
Xinpu	China	34.60	119.16
Xinxiang	China	35.19	113.80
Xinyang	China	32.12	114.07
Xinyuan	China	43.43	83.25
Xiuying	China	20.00	110.29
Xuchang	China	34.03	113.86
Yancheng	China	33.36	120.16
Yangjiang	China	21.86	111.96
Yangquan	China	37.86	113.56
Yangshuo	China	24.78	110.49
Yangzhou	China	32.40	119.44
Yanji	China	42.91	129.51
Yantai	China	37.48	121.44
Yichang	China	30.71	111.28
Yinchuan	China	38.47	106.27
Yingkou	China	40.66	122.23
Yueyang	China	29.37	113.09
Yunfu	China	22.93	112.04
Zhabei	China	31.26	121.46
Zhangjiakou	China	40.81	114.88
Zhangjiakou Shi Xuanhua Qu	China	40.61	115.04
Zhangzhou	China	24.51	117.66
Zhanjiang	China	21.28	110.34
Zhaoqing	China	23.05	112.46
Zhengzhou	China	34.76	113.65
Zhenjiang	China	32.21	119.46
Zhongshan	China	21.32	110.57
Zhoukou	China	33.63	114.63
Zhu Cheng City	China	36.00	119.40
Zhuhai	China	22.28	113.57
Zhumadian	China	32.98	114.03
Zhuzhou	China	27.83	113.15
Zibo	China	36.79	118.06
Zigong	China	29.34	104.78
Zunyi	China	27.69	106.91
Flying Fish Cove	Christmas Island	-10.42	105.68
Aurora	CO	39.73	-104.83
Colorado Springs	CO	38.83	-104.82
West Island	Cocos (Keeling) Islands	-12.16	96.82
Denver	CO	39.74	-104.98
Arauca	Colombia	7.08	-70.76
Armenia	Colombia	4.53	-75.68
Barranquilla	Colombia	10.97	-74.78
Bello	Colombia	6.34	-75.56
Bogotá	Colombia	4.61	-74.08
Bucaramanga	Colombia	7.13	-73.12
Cali	Colombia	3.44	-76.52
Cartagena	Colombia	10.40	-75.51
Cúcuta	Colombia	7.89	-72.51
Florencia	Colombia	1.61	-75.61
Floridablanca	Colombia	7.06	-73.09
Ibagué	Colombia	4.44	-75.23
Itagüí	Colombia	6.18	-75.60
Leticia	Colombia	-4.22	-69.94
Manizales	Colombia	5.07	-75.52
Medellín	Colombia	6.25	-75.56
Montería	Colombia	8.75	-75.88
Neiva	Colombia	2.93	-75.28
Pasto	Colombia	1.21	-77.28
Pereira	Colombia	4.81	-75.70
Popayán	Colombia	2.44	-76.61
Quibdó	Colombia	5.69	-76.66
Riohacha	Colombia	11.54	-72.91
San Andrés	Colombia	12.58	-81.71
Santa Marta	Colombia	11.24	-74.20
Sincelejo	Colombia	9.30	-75.40
Soacha	Colombia	4.58	-74.22
Soledad	Colombia	10.92	-74.76
Tunja	Colombia	5.54	-73.37
Valledupar	Colombia	10.46	-73.25
Villavicencio	Colombia	4.14	-73.63
Yopal	Colombia	5.34	-72.40
Moroni	Comoros	-11.70	43.26
Brazzaville	Congo - Brazzaville	-4.27	15.28
Dolisie	Congo - Brazzaville	-4.20	12.67
Pointe-Noire	Congo - Brazzaville	-4.78	11.86
Boende	Congo - Kinshasa	-0.28	20.88
Bukavu	Congo - Kinshasa	-2.49	28.84
Bunia	Congo - Kinshasa	1.56	30.25
Buta	Congo - Kinshasa	2.79	24.73
Gbadolite	Congo - Kinshasa	4.28	21.00
Goma	Congo - Kinshasa	-1.67	29.23
Inongo	Congo - Kinshasa	-1.93	18.29
Isiro	Congo - Kinshasa	2.77	27.62
Kamina	Congo - Kinshasa	-8.74	25.00
Kananga	Congo - Kinshasa	-5.90	22.42
Kindu	Congo - Kinshasa	-2.94	25.92
Kinshasa	Congo - Kinshasa	-4.33	15.31
Kisangani	Congo - Kinshasa	0.52	25.19
Kolwezi	Congo - Kinshasa	-10.71	25.47
Likasi	Congo - Kinshasa	-10.98	26.74
Lubumbashi	Congo - Kinshasa	-11.66	27.48
Luebo	Congo - Kinshasa	-5.35	21.42
Lusambo	Congo - Kinshasa	-4.98	23.44
Masina	Congo - Kinshasa	-4.38	15.39
Matadi	Congo - Kinshasa	-5.84	13.46
Mbandaka	Congo - Kinshasa	0.05	18.26
Mbuji-Mayi	Congo - Kinshasa	-6.14	23.59
Tshikapa	Congo - Kinshasa	-6.42	20.80
Avarua	Cook Islands	-21.21	-159.78
Alajuela	Costa Rica	10.02	-84.21
Cartago	Costa Rica	9.86	-83.92
Liberia	Costa Rica	10.64	-85.44
Limón	Costa Rica	9.99	-83.04
Puntarenas	Costa Rica	9.98	-84.84
San José	Costa Rica	9.93	-84.08
Abengourou	Côte d’Ivoire	6.73	-3.50
Abidjan	Côte d’Ivoire	5.35	-4.00
Abobo	Côte d’Ivoire	5.42	-4.02
Bondoukou	Côte d’Ivoire	8.04	-2.80
Bouaké	Côte d’Ivoire	7.69	-5.03
Daloa	Côte d’Ivoire	6.88	-6.45
Dimbokro	Côte d’Ivoire	6.65	-4.71
Gagnoa	Côte d’Ivoire	6.13	-5.95
Korhogo	Côte d’Ivoire	9.46	-5.63
Man	Côte d’Ivoire	7.41	-7.55
Odienné	Côte d’Ivoire	9.51	-7.56
San-Pédro	Côte d’Ivoire	4.75	-6.64
Séguéla	Côte d’Ivoire	7.96	-6.67
Yamoussoukro	Côte d’Ivoire	6.82	-5.28
Bjelovar	Croatia	45.90	16.85
Dubrovnik	Croatia	42.64	18.11
Karlovac	Croatia	45.49	15.55
Koprivnica	Croatia	46.16	16.83
Osijek	Croatia	45.55	18.69
Rijeka	Croatia	45.33	14.44
Šibenik	Croatia	43.73	15.89
Sisak	Croatia	45.47	16.38
Slavonski Brod	Croatia	45.16	18.02
Split	Croatia	43.51	16.44
Varaždin	Croatia	46.30	16.34
Vukovar	Croatia	45.35	19.00
Zadar	Croatia	44.12	15.23
Zagreb	Croatia	45.81	15.98
Hartford	CT	41.76	-72.69
Artemisa	Cuba	22.82	-82.76
Bayamo	Cuba	20.37	-76.64
Camagüey	Cuba	21.38	-77.92
Ciego de Ávila	Cuba	21.84	-78.76
Cienfuegos	Cuba	22.15	-80.45
Guantánamo	Cuba	20.14	-75.21
Havana	Cuba	23.13	-82.38
Holguín	Cuba	20.89	-76.26
Las Tunas	Cuba	20.96	-76.95
Matanzas	Cuba	23.04	-81.58
Pinar del Río	Cuba	22.42	-83.70
San José de las Lajas	Cuba	22.96	-82.15
Sancti Spíritus	Cuba	21.93	-79.44
Santa Clara	Cuba	22.41	-79.96
Santiago de Cuba	Cuba	20.02	-75.83
Willemstad	Curaçao	12.11	-68.93
Famagusta	Cyprus	35.12	33.94
Kyrenia	Cyprus	35.34	33.32
Larnaca	Cyprus	34.92	33.62
Limassol	Cyprus	34.68	33.04
Nicosia	Cyprus	35.18	33.36
Paphos	Cyprus	34.78	32.42
Brno	Czechia	49.20	16.61
České Budějovice	Czechia	48.97	14.47
Hradec Králové	Czechia	50.21	15.83
Jihlava	Czechia	49.40	15.59
Karlovy Vary	Czechia	50.23	12.87
Liberec	Czechia	50.77	15.06
Olomouc	Czechia	49.60	17.25
Ostrava	Czechia	49.83	18.28
Pardubice	Czechia	50.04	15.78
Pilsen	Czechia	49.75	13.38
Prague	Czechia	50.09	14.42
Ústí nad Labem	Czechia	50.66	14.03
Zlín	Czechia	49.23	17.67
Washington, D.C.	DC	38.90	-77.04
Dover	DE	39.16	-75.52
Aalborg	Denmark	57.05	9.92
Copenhagen	Denmark	55.68	12.57
Hillerød	Denmark	55.93	12.30
Vejle	Denmark	55.71	9.54
Viborg	Denmark	56.45	9.40
'Ali Sabieh	Djibouti	11.16	42.71
Djibouti	Djibouti	11.59	43.15
Azua	Dominican Republic	18.45	-70.73
Baní	Dominican Republic	18.28	-70.33
Bonao	Dominican Republic	18.94	-70.41
Concepción de La Vega	Dominican Republic	19.22	-70.53
Cotuí	Dominican Republic	19.05	-70.15
Hato Mayor del Rey	Dominican Republic	18.76	-69.26
La Romana	Dominican Republic	18.43	-68.97
Mao	Dominican Republic	19.55	-71.08
Moca	Dominican Republic	19.39	-70.53
Nagua	Dominican Republic	19.38	-69.85
Puerto Plata	Dominican Republic	19.79	-70.69
Salcedo	Dominican Republic	19.38	-70.42
Salvaleón de Higüey	Dominican Republic	18.62	-68.71
San Cristóbal	Dominican Republic	18.42	-70.10
San Francisco de Macorís	Dominican Republic	19.30	-70.25
San Juan de la Maguana	Dominican Republic	18.81	-71.23
San Pedro de Macorís	Dominican Republic	18.45	-69.31
Santa Cruz de Barahona	Dominican Republic	18.21	-71.10
Santiago de los Caballeros	Dominican Republic	19.45	-70.70
Santo Domingo	Dominican Republic	18.47	-69.89
Santo Domingo Este	Dominican Republic	18.49	-69.86
Santo Domingo Oeste	Dominican Republic	18.50	-70.00
Roseau	Dominica	15.30	-61.39
Ambato	Ecuador	-1.25	-78.62
Azogues	Ecuador	-2.74	-78.85
Babahoyo	Ecuador	-1.80	-79.53
Cuenca	Ecuador	-2.90	-79.00
Esmeraldas	Ecuador	0.96	-79.65
Guayaquil	Ecuador	-2.20	-79.89
Ibarra	Ecuador	0.35	-78.12
Latacunga	Ecuador	-0.94	-78.62
Loja	Ecuador	-3.99	-79.20
Machala	Ecuador	-3.26	-79.96
Portoviejo	Ecuador	-1.05	-80.45
Puerto Francisco de Orellana	Ecuador	-0.47	-76.99
Quito	Ecuador	-0.23	-78.52
Riobamba	Ecuador	-1.67	-78.65
Santa Elena	Ecuador	-2.23	-80.86
Santo Domingo de los Colorados	Ecuador	-0.25	-79.18
Tulcán	Ecuador	0.81	-77.72
Al Fayyūm	Egypt	29.31	30.84
Al Khārijah	Egypt	25.45	30.55
Al Maḩallah al Kubrá	Egypt	30.97	31.17
Al Manşūrah	Egypt	31.04	31.38
Al Minyā	Egypt	28.09	30.76
Alexandria	Egypt	31.20	29.92
Arish	Egypt	31.13	33.80
Aswan	Egypt	24.09	32.90
Asyūţ	Egypt	27.18	31.18
Banhā	Egypt	30.46	31.18
Banī Suwayf	Egypt	29.07	31.10
Cairo	Egypt	30.06	31.25
Damanhūr	Egypt	31.03	30.47
Damietta	Egypt	31.42	31.81
Giza	Egypt	30.01	31.21
Hurghada	Egypt	27.26	33.81
Ismailia	Egypt	30.60	32.27
Kafr ad Dawwār	Egypt	31.13	30.13
Kafr ash Shaykh	Egypt	31.11	30.94
Luxor	Egypt	25.70	32.64
Mersa Matruh	Egypt	31.35	27.24
Port Said	Egypt	31.27	32.30
Qinā	Egypt	26.16	32.73
Shibīn al Kawm	Egypt	30.55	31.01
Sohag	Egypt	26.56	31.69
Suez	Egypt	29.97	32.53
Tanda	Egypt	30.79	31.00
Zagazig	Egypt	30.59	31.50
Ahuachapán	El Salvador	13.92	-89.84
Cojutepeque	El Salvador	13.72	-88.93
La Unión	El Salvador	13.34	-87.84
San Miguel	El Salvador	13.48	-88.18
San Salvador	El Salvador	13.69	-89.19
San Vicente	El Salvador	13.63	-88.80
Santa Ana	El Salvador	13.99	-89.56
Santa Tecla	El Salvador	13.68	-89.28
Sonsonate	El Salvador	13.72	-89.72
Soyapango	El Salvador	13.71	-89.14
Usulután	El Salvador	13.35	-88.45
Zacatecoluca	El Salvador	13.50	-88.87
Bata	Equatorial Guinea	1.86	9.77
Malabo	Equatorial Guinea	3.76	8.78
Asmara	Eritrea	15.34	38.93
Keren	Eritrea	15.78	38.45
Pärnu	Estonia	58.39	24.50
Tallinn	Estonia	59.44	24.75
Tartu	Estonia	58.38	26.73
Manzini	Eswatini	-26.50	31.38
Mbabane	Eswatini	-26.32	31.13
Addis Ababa	Ethiopia	9.02	38.75
Āsosa	Ethiopia	10.07	34.53
Bahir Dar	Ethiopia	11.59	37.39
Dire Dawa	Ethiopia	9.59	41.87
Gambēla	Ethiopia	8.25	34.58
Harar	Ethiopia	9.31	42.12
Hawassa	Ethiopia	7.06	38.48
Jijiga	Ethiopia	9.35	42.80
Mek'ele	Ethiopia	13.50	39.48
Stanley	Falkland Islands	-51.69	-57.86
Tórshavn	Faroe Islands	62.01	-6.77
Labasa	Fiji	-16.43	179.36
Lautoka	Fiji	-17.62	177.45
Suva	Fiji	-18.14	178.44
Espoo	Finland	60.21	24.65
Hämeenlinna	Finland	61.00	24.46
Helsinki	Finland	60.17	24.94
Joensuu	Finland	62.60	29.76
Jyväskylä	Finland	62.24	25.72
Kajaani	Finland	64.23	27.73
Kokkola	Finland	63.84	23.13
Kouvola	Finland	60.87	26.70
Kuopio	Finland	62.89	27.68
Lahti	Finland	60.98	25.66
Lappeenranta	Finland	61.06	28.19
Mikkeli	Finland	61.69	27.27
Oulu	Finland	65.01	25.47
Pori	Finland	61.48	21.78
Rovaniemi	Finland	66.50	25.72
Seinäjoki	Finland	62.79	22.83
Tampere	Finland	61.50	23.79
Turku	Finland	60.45	22.27
Vaasa	Finland	63.10	21.62
Jacksonville	FL	30.33	-81.66
Miami	FL	25.77	-80.19
Orlando	FL	28.54	-81.38
St. Petersburg	FL	27.77	-82.68
Tallahassee	FL	30.44	-84.28
Tampa	FL	27.95	-82.46
Ajaccio	France	41.92	8.74
Bordeaux	France	44.84	-0.58
Dijon	France	47.32	5.02
Lille	France	50.63	3.06
Lyon	France	45.75	4.85
Marseille	France	43.30	5.38
Nantes	France	47.22	-1.55
Nice	France	43.70	7.27
Orléans	France	47.90	1.90
Paris	France	48.85	2.35
Rennes	France	48.11	-1.67
Rouen	France	49.44	1.10
Strasbourg	France	48.58	7.75
Toulouse	France	43.60	1.44
Cayenne	French Guiana	4.93	-52.33
Papeete	French Polynesia	-17.54	-149.57
Port-aux-Français	French Southern Territories	-49.35	70.22
Atlanta	GA	33.75	-84.39
Franceville	Gabon	-1.63	13.58
Libreville	Gabon	0.39	9.45
Oyem	Gabon	1.60	11.58
Port-Gentil	Gabon	-0.72	8.78
Banjul	Gambia	13.45	-16.58
Brikama	Gambia	13.27	-16.65
Serekunda	Gambia	13.44	-16.68
Batumi	Georgia	41.64	41.63
Gori	Georgia	41.98	44.12
Kutaisi	Georgia	42.27	42.69
Rustavi	Georgia	41.56	44.98
Sokhumi	Georgia	43.01	40.99
Tbilisi	Georgia	41.69	44.83
Zugdidi	Georgia	42.51	41.87
Aachen	Germany	50.78	6.08
Altona	Germany	53.55	9.93
Augsburg	Germany	48.37	10.90
Berlin	Germany	52.52	13.41
Bielefeld	Germany	52.03	8.53
Bochum	Germany	51.48	7.22
Bochum-Hordel	Germany	51.50	7.18
Bonn	Germany	50.73	7.10
Bremen	Germany	53.08	8.81
Dortmund	Germany	51.51	7.47
Dresden	Germany	51.05	13.74
Duisburg	Germany	51.43	6.77
Düsseldorf	Germany	51.22	6.78
Eimsbüttel	Germany	53.57	9.96
Erfurt	Germany	50.98	11.03
Essen	Germany	51.46	7.01
Frankfurt am Main	Germany	50.12	8.68
Gelsenkirchen	Germany	51.51	7.10
Hamburg	Germany	53.55	9.99
Hamburg-Nord	Germany	53.59	9.98
Hannover	Germany	52.37	9.73
Karlsruhe	Germany	49.01	8.40
Kiel	Germany	54.32	10.13
Köln	Germany	50.93	6.95
Leipzig	Germany	51.34	12.37
Magdeburg	Germany	52.13	11.63
Mainz	Germany	49.98	8.28
Mannheim	Germany	49.49	8.47
Marienthal	Germany	53.57	10.08
Mönchengladbach	Germany	51.19	6.44
Munich	Germany	48.14	11.58
Münster	Germany	51.96	7.63
Nürnberg	Germany	49.45	11.08
Potsdam	Germany	52.40	13.07
Saarbrücken	Germany	49.23	7.01
Schwerin	Germany	53.63	11.41
Stuttgart	Germany	48.78	9.18
Wandsbek	Germany	53.58	10.08
Wiesbaden	Germany	50.08	8.25
Wuppertal	Germany	51.26	7.15
Accra	Ghana	5.56	-0.20
Bolgatanga	Ghana	10.79	-0.85
Cape Coast	Ghana	5.11	-1.25
Ho	Ghana	6.60	0.47
Koforidua	Ghana	6.09	-0.26
Kumasi	Ghana	6.69	-1.62
Sekondi-Takoradi	Ghana	4.93	-1.76
Sunyani	Ghana	7.34	-2.33
Tamale	Ghana	9.40	-0.84
Techiman	Ghana	7.59	-1.94
Wa	Ghana	10.06	-2.50
Gibraltar	Gibraltar	36.14	-5.35
Athens	Greece	37.98	23.73
Corfu	Greece	39.62	19.92
Ioánnina	Greece	39.66	20.85
Irákleion	Greece	35.33	25.14
Komotiní	Greece	41.12	25.41
Kozáni	Greece	40.30	21.79
Lamía	Greece	38.90	22.43
Lárisa	Greece	39.64	22.42
Mytilene	Greece	39.11	26.56
Pátra	Greece	38.24	21.73
Thessaloníki	Greece	40.64	22.93
Trípoli	Greece	37.51	22.38
Nuuk	Greenland	64.18	-51.72
Saint George's	Grenada	12.05	-61.75
Basse-Terre	Guadeloupe	16.00	-61.73
Dededo Village	Guam	13.52	144.84
Hagåtña	Guam	13.48	144.75
Antigua Guatemala	Guatemala	14.56	-90.73
Chimaltenango	Guatemala	14.66	-90.82
Chiquimula	Guatemala	14.80	-89.55
Cobán	Guatemala	15.47	-90.37
Escuintla	Guatemala	14.30	-90.79
Guatemala City	Guatemala	14.64	-90.51
Huehuetenango	Guatemala	15.32	-91.47
Jalapa	Guatemala	14.63	-89.99
Jutiapa	Guatemala	14.29	-89.90
Mazatenango	Guatemala	14.53	-91.50
Mixco	Guatemala	14.63	-90.61
Puerto Barrios	Guatemala	15.73	-88.59
Quetzaltenango	Guatemala	14.83	-91.52
Retalhuleu	Guatemala	14.54	-91.68
Salamá	Guatemala	15.10	-90.32
San Marcos	Guatemala	14.96	-91.79
Sololá	Guatemala	14.77	-91.18
Totonicapán	Guatemala	14.91	-91.36
Villa Nueva	Guatemala	14.53	-90.59
Zacapa	Guatemala	14.97	-89.53
Saint Peter Port	Guernsey	49.46	-2.54
Bissau	Guinea-Bissau	11.86	-15.60
Camayenne	Guinea	9.54	-13.69
Conakry	Guinea	9.54	-13.68
Kankan	Guinea	10.39	-9.31
Kindia	Guinea	10.06	-12.87
Mamou	Guinea	10.38	-12.09
Nzérékoré	Guinea	7.76	-8.82
Georgetown	Guyana	6.80	-58.16
Linden	Guyana	6.01	-58.31
New Amsterdam	Guyana	6.25	-57.52
Carrefour	Haiti	18.54	-72.40
Delmas 73	Haiti	18.54	-72.30
Gonaïves	Haiti	19.45	-72.69
Jacmel	Haiti	18.23	-72.54
Jérémie	Haiti	18.65	-74.12
Les Cayes	Haiti	18.19	-73.75
Miragoâne	Haiti	18.45	-73.09
Okap	Haiti	19.76	-72.20
Pétionville	Haiti	18.51	-72.29
Port-au-Prince	Haiti	18.54	-72.34
Port-de-Paix	Haiti	19.94	-72.83
Honolulu	HI	21.31	-157.86
Ciudad Choluteca	Honduras	13.30	-87.19
Comayagua	Honduras	14.45	-87.64
Juticalpa	Honduras	14.67	-86.22
La Ceiba	Honduras	15.76	-86.78
San Pedro Sula	Honduras	15.50	-88.03
Santa Rosa de Copán	Honduras	14.77	-88.78
Tegucigalpa	Honduras	14.08	-87.21
Hong Kong	Hong Kong SAR China	22.28	114.17
Kowloon	Hong Kong SAR China	22.32	114.18
Tsuen Wan	Hong Kong SAR China	22.37	114.11
Yuen Long Kau Hui	Hong Kong SAR China	22.45	114.03
Békéscsaba	Hungary	46.68	21.10
Budapest	Hungary	47.50	19.04
Debrecen	Hungary	47.53	21.62
Eger	Hungary	47.90	20.37
Győr	Hungary	47.68	17.64
Kaposvár	Hungary	46.37	17.80
Kecskemét	Hungary	46.91	19.69
Miskolc	Hungary	48.10	20.78
Nyíregyháza	Hungary	47.96	21.72
Pécs	Hungary	46.07	18.23
Salgótarján	Hungary	48.10	19.80
Szeged	Hungary	46.25	20.15
Székesfehérvár	Hungary	47.19	18.41
Szekszárd	Hungary	46.35	18.71
Szolnok	Hungary	47.18	20.20
Szombathely	Hungary	47.23	16.62
Tatabánya	Hungary	47.58	18.39
Veszprém	Hungary	47.09	17.91
Zalaegerszeg	Hungary	46.84	16.84
Des Moines	IA	41.60	-93.61
Reykjavík	Iceland	64.14	-21.90
Boise	ID	43.61	-116.20
Chicago	IL	41.85	-87.65
Springfield	IL	39.80	-89.64
Agartala	India	23.84	91.28
Agra	India	27.18	78.02
Ahmadnagar	India	19.09	74.74
Ahmedabad	India	23.03	72.59
Aizawl	India	23.73	92.72
Ajmer	India	26.45	74.64
Akola	India	20.71	77.00
Alīgarh	India	27.88	78.07
Allahābād	India	25.44	81.84
Alwar	India	27.56	76.63
Ambattūr	India	13.10	80.16
Amrāvati	India	20.93	77.75
Amritsar	India	31.62	74.88
Āsansol	India	23.68	86.98
Aurangabad	India	19.88	75.34
Āvadi	India	13.11	80.11
Bāli	India	22.65	88.34
Baranagar	India	22.64	88.38
Bārāsat	India	22.72	88.48
Barddhamān	India	23.26	87.86
Bareilly	India	28.37	79.43
Belgaum	India	15.85	74.50
Bellary	India	15.14	76.92
Bengaluru	India	12.97	77.59
Bhāgalpur	India	25.24	86.97
Bhātpāra	India	22.87	88.40
Bhavnagar	India	21.76	72.15
Bhayandar	India	19.30	72.85
Bhilai	India	21.21	81.43
Bhīlwāra	India	25.35	74.64
Bhiwandi	India	19.30	73.06
Bhopal	India	23.25	77.40
Bhubaneshwar	India	20.27	85.83
Bijapur	India	16.82	75.72
Bīkaner	India	28.02	73.31
Bilāspur	India	22.08	82.16
Bilimora	India	20.77	72.96
Bokāro	India	23.79	85.96
Borivli	India	19.23	72.86
Brahmapur	India	19.31	84.79
Chānda	India	19.95	79.30
Chandigarh	India	30.74	76.79
Chennai	India	13.09	80.28
Cochin	India	9.94	76.26
Coimbatore	India	11.01	76.97
Cuttack	India	20.46	85.88
Daman	India	20.41	72.83
Darbhanga	India	26.15	85.90
Davangere	India	14.47	75.93
Dehra Dūn	India	30.32	78.03
Delhi	India	28.65	77.23
Dewas	India	22.97	76.06
Dhūlia	India	20.90	74.78
Dombivli	India	19.22	73.08
Durg	India	21.19	81.28
Durgapur	India	23.52	87.31
Etāwah	India	26.78	79.02
Faridabad	India	28.41	77.31
Fīrozābād	India	27.15	78.40
Gajuwaka	India	17.70	83.22
Gandhinagar	India	23.22	72.68
Gangtok	India	27.33	88.61
Gaya	India	24.80	85.00
Ghāziābād	India	28.67	77.44
Gorakhpur	India	29.45	75.67
Greater Noida	India	28.50	77.54
Gulbarga	India	17.34	76.84
Guntur	India	16.30	80.46
Guwahati	India	26.18	91.75
Gwalior	India	26.23	78.17
Hāora	India	22.58	88.32
Hisar	India	29.15	75.72
Hubli	India	15.35	75.13
Hyderabad	India	17.38	78.46
Ichalkaranji	India	16.69	74.46
Imphal	India	24.81	93.94
Indore	India	22.72	75.83
Itānagar	India	27.09	93.61
Jabalpur	India	23.17	79.95
Jaipur	India	26.92	75.79
Jalandhar	India	31.33	75.58
Jalgaon	India	21.00	75.57
Jālna	India	19.84	75.89
Jammu	India	32.74	74.87
Jamnagar	India	22.47	70.07
Jamshedpur	India	22.80	86.19
Jhānsi	India	25.46	78.58
Jodhpur	India	26.27	73.01
Kākināda	India	16.96	82.24
Kalyān	India	19.24	73.14
Kāmārhāti	India	22.67	88.37
Kanpur	India	26.47	80.35
Karol Bāgh	India	28.65	77.19
Kohima	India	25.67	94.11
Kolhāpur	India	16.70	74.23
Kolkata	India	22.56	88.36
Kollam	India	8.88	76.58
Korba	India	22.35	82.70
Kota	India	25.18	75.84
Kozhikode	India	11.25	75.78
Kūkatpalli	India	17.48	78.41
Kulti	India	23.73	86.84
Kurnool	India	15.83	78.04
Lal Bahadur Nagar	India	17.35	78.56
Latur	India	18.40	76.57
Lucknow	India	26.84	80.92
Ludhiāna	India	30.91	75.85
Madurai	India	9.92	78.12
Mālegaon	India	20.55	74.53
Mangalore	India	12.92	74.86
Mathura	India	27.50	77.67
Meerut	India	28.98	77.71
Morādābād	India	28.84	78.78
Mumbai	India	19.07	72.88
Muzaffarnagar	India	29.47	77.70
Muzaffarpur	India	26.12	85.39
Mysore	India	12.30	76.64
Nagpur	India	21.15	79.08
Naihāti	India	22.89	88.42
Najafgarh	India	28.61	76.98
Nanded	India	19.16	77.31
Nangi	India	22.51	88.22
Narela	India	28.85	77.09
Nashik	India	20.00	73.79
Navi Mumbai	India	19.04	73.02
Nellore	India	14.45	79.99
New Delhi	India	28.64	77.22
Nizāmābād	India	18.67	78.10
Noida	India	28.58	77.33
Nowrangapur	India	19.23	82.55
Panaji	India	15.50	73.83
Pānihāti	India	22.69	88.37
Pānīpat	India	29.39	76.97
Parbhani	India	19.27	76.77
Patiāla	India	30.34	76.39
Patna	India	25.59	85.14
Pimpri	India	18.62	73.81
Port Blair	India	11.67	92.75
Puducherry	India	11.93	79.83
Punāsa	India	22.24	76.39
Pune	India	18.52	73.86
Raipur	India	21.23	81.63
Rājahmundry	India	17.01	81.78
Rājkot	India	22.29	70.79
Rāmgundam	India	18.80	79.45
Rāmpur	India	28.81	79.03
Ranchi	India	23.34	85.31
Raurkela	India	22.22	84.86
Rohini	India	28.74	77.07
Rohtak	India	28.89	76.59
Sahāranpur	India	29.97	77.55
Salem	India	11.65	78.16
Sāngli	India	16.85	74.56
Satna	India	24.58	80.83
Shāhjānpur	India	27.88	79.91
Shillong	India	25.57	91.88
Shimla	India	31.10	77.17
Shimoga	India	13.93	75.57
Shivaji Nagar	India	18.53	73.85
Shyamnagar	India	22.83	88.37
Siliguri	India	26.71	88.43
Silvassa	India	20.27	73.00
Solāpur	India	17.67	75.91
Sonīpat	India	28.99	77.02
Srinagar	India	34.09	74.81
Sūrat	India	21.20	72.83
Teni	India	10.01	77.48
Thāne	India	19.20	72.96
Thiruvananthapuram	India	8.49	76.95
Thoothukudi	India	8.77	78.13
Thrissur	India	10.52	76.22
Tiruchirappalli	India	10.82	78.70
Tirunelveli	India	8.73	77.68
Tirupati	India	13.64	79.42
Tiruppur	India	11.12	77.35
Tumkūr	India	13.34	77.10
Udaipur	India	24.59	73.71
Ujjain	India	23.18	75.78
Ulhasnagar	India	19.22	73.15
Vadodara	India	22.30	73.21
Varanasi	India	25.32	83.01
Vijayawada	India	16.51	80.65
Visakhapatnam	India	17.68	83.20
Warangal	India	18.00	79.58
Ambon	Indonesia	-3.70	128.18
Balikpapan	Indonesia	-1.27	116.83
Banda Aceh	Indonesia	5.54	95.33
Bandar Lampung	Indonesia	-5.43	105.26
Bandung	Indonesia	-6.92	107.61
Banjarmasin	Indonesia	-3.32	114.59
Batam	Indonesia	1.15	104.02
Bekasi	Indonesia	-6.23	106.99
Bengkulu	Indonesia	-3.80	102.27
Bogor	Indonesia	-6.59	106.79
Cimahi	Indonesia	-6.87	107.54
Cirebon	Indonesia	-6.71	108.56
City of Balikpapan	Indonesia	-1.24	116.89
Denpasar	Indonesia	-8.65	115.22
Depok	Indonesia	-6.40	106.82
Gorontalo	Indonesia	0.54	123.06
Jakarta	Indonesia	-6.21	106.85
Jambi City	Indonesia	-1.60	103.62
Jayapura	Indonesia	-2.53	140.72
Jember	Indonesia	-8.17	113.70
Kendari	Indonesia	-3.98	122.52
Kupang	Indonesia	-10.17	123.61
Makassar	Indonesia	-5.15	119.43
Malang	Indonesia	-7.98	112.63
Manado	Indonesia	1.48	124.85
Manokwari	Indonesia	-0.86	134.06
Mataram	Indonesia	-8.58	116.12
Medan	Indonesia	3.58	98.67
Padang	Indonesia	-0.95	100.35
Palangkaraya	Indonesia	-2.21	113.92
Palembang	Indonesia	-2.92	104.75
Palu	Indonesia	-0.91	119.87
Pangkalpinang	Indonesia	-2.13	106.11
Pekalongan	Indonesia	-6.89	109.68
Pekanbaru	Indonesia	0.52	101.44
Percut	Indonesia	3.63	98.86
Pontianak	Indonesia	-0.03	109.33
Samarinda	Indonesia	-0.49	117.15
Semarang	Indonesia	-6.99	110.42
Serang	Indonesia	-6.12	106.15
Situbondo	Indonesia	-7.71	114.01
Sofifi	Indonesia	0.74	127.56
South Tangerang	Indonesia	-6.29	106.72
Sukabumi	Indonesia	-6.92	106.93
Surabaya	Indonesia	-7.25	112.75
Surakarta	Indonesia	-7.56	110.83
Tangerang	Indonesia	-6.18	106.63
Tasikmalaya	Indonesia	-7.33	108.22
Yogyakarta	Indonesia	-7.80	110.36
Fort Wayne	IN	41.13	-85.13
Indianapolis	IN	39.77	-86.16
Abadan	Iran	30.34	48.30
Ahvaz	Iran	31.32	48.68
Arāk	Iran	34.09	49.70
Ardabīl	Iran	38.25	48.29
Āzādshahr	Iran	34.79	48.57
Bandar Abbas	Iran	27.19	56.28
Bīrjand	Iran	32.87	59.22
Bojnūrd	Iran	37.47	57.33
Borūjerd	Iran	33.90	48.75
Bushehr	Iran	28.97	50.84
Gorgān	Iran	36.84	54.44
Hamadān	Iran	34.80	48.51
Īlām	Iran	33.64	46.42
Isfahan	Iran	32.65	51.67
Kahrīz	Iran	34.38	47.06
Karaj	Iran	35.83	50.99
Kerman	Iran	30.28	57.08
Kermanshah	Iran	34.31	47.06
Khomeynī Shahr	Iran	32.69	51.54
Khorramabad	Iran	33.49	48.36
Khorramshahr	Iran	30.44	48.18
Mashhad	Iran	36.32	59.57
Orūmīyeh	Iran	37.55	45.08
Pasragad Branch	Iran	34.78	48.47
Qarchak	Iran	35.43	51.58
Qazvin	Iran	36.27	50.00
Qom	Iran	34.64	50.88
Rasht	Iran	37.28	49.59
Sanandaj	Iran	35.31	47.00
Sari	Iran	36.56	53.06
Semnan	Iran	35.58	53.39
Shahr-e Kord	Iran	32.33	50.86
Shiraz	Iran	29.61	52.53
Tabriz	Iran	38.08	46.29
Tehran	Iran	35.69	51.42
Yasuj	Iran	30.67	51.59
Yazd	Iran	31.90	54.37
Zahedan	Iran	29.50	60.86
Zanjān	Iran	36.68	48.50
Abū Ghurayb	Iraq	33.31	44.18
Ad Dīwānīyah	Iraq	31.99	44.93
Al ‘Amārah	Iraq	31.84	47.14
Al Başrah al Qadīmah	Iraq	30.50	47.82
Al Ḩillah	Iraq	32.46	44.42
Al Kūt	Iraq	32.51	45.82
Al Mawşil al Jadīdah	Iraq	36.33	43.11
As Samawah	Iraq	31.33	45.29
As Sulaymānīyah	Iraq	35.56	45.43
Baghdad	Iraq	33.34	44.40
Baqubah	Iraq	33.75	44.61
Basrah	Iraq	30.51	47.78
Dihok	Iraq	36.87	42.99
Erbil	Iraq	36.18	44.01
Karbala	Iraq	32.62	44.02
Kirkuk	Iraq	35.47	44.39
Mosul	Iraq	36.34	43.12
Najaf	Iraq	32.03	44.35
Nasiriyah	Iraq	31.06	46.26
Ramadi	Iraq	33.42	43.31
Tikrīt	Iraq	34.62	43.68
Dublin	Ireland	53.33	-6.25
Gaillimh	Ireland	53.27	-9.05
Swords	Ireland	53.46	-6.22
Douglas	Isle of Man	54.15	-4.48
Beersheba	Israel	31.25	34.79
Haifa	Israel	32.82	34.99
Jerusalem	Israel	31.77	35.22
Nazareth	Israel	32.70	35.30
Ramla	Israel	31.93	34.87
Tel Aviv	Israel	32.08	34.78
West Jerusalem	Israel	31.78	35.22
Ancona	Italy	43.59	13.50
Aosta	Italy	45.74	7.32
Bari	Italy	41.12	16.87
Bologna	Italy	44.49	11.34
Cagliari	Italy	39.23	9.12
Campobasso	Italy	41.56	14.67
Catania	Italy	37.49	15.07
Catanzaro	Italy	38.88	16.60
Florence	Italy	43.78	11.25
Genoa	Italy	44.40	8.94
L'Aquila	Italy	42.35	13.40
Milan	Italy	45.46	9.19
Naples	Italy	40.85	14.27
Palermo	Italy	38.13	13.34
Perugia	Italy	43.11	12.39
Potenza	Italy	40.64	15.81
Rome	Italy	41.89	12.51
Trento	Italy	46.07	11.12
Trieste	Italy	45.65	13.78
Turin	Italy	45.07	7.69
Venice	Italy	45.44	12.33
Kingston	Jamaica	18.00	-76.79
Mandeville	Jamaica	18.04	-77.51
May Pen	Jamaica	17.96	-77.25
Montego Bay	Jamaica	18.47	-77.92
New Kingston	Jamaica	18.01	-76.78
Spanish Town	Jamaica	17.99	-76.96
Akashi	Japan	34.66	135.01
Akita	Japan	39.72	140.12
Amagasaki	Japan	34.72	135.42
Aomori	Japan	40.82	140.73
Asahikawa	Japan	43.77	142.36
Chiba	Japan	35.60	140.12
Fujisawa	Japan	35.35	139.48
Fukui-shi	Japan	36.06	136.22
Fukuoka	Japan	33.60	130.42
Fukushima	Japan	37.75	140.47
Fukuyama	Japan	34.48	133.37
Gifu-shi	Japan	35.42	136.76
Hachiōji	Japan	35.66	139.32
Hakodate	Japan	41.78	140.74
Hamamatsu	Japan	34.70	137.73
Himeji	Japan	34.82	134.70
Hirakata	Japan	34.81	135.65
Hiratsuka	Japan	35.33	139.34
Hiroshima	Japan	34.40	132.45
Honchō	Japan	35.70	139.99
Ibaraki	Japan	34.82	135.57
Ichihara	Japan	35.52	140.08
Ichinomiya	Japan	35.30	136.80
Iwaki	Japan	37.05	140.88
Kagoshima	Japan	31.57	130.55
Kakogawachō-honmachi	Japan	34.77	134.83
Kanazawa	Japan	36.60	136.62
Kashiwa	Japan	35.86	139.98
Kasugai	Japan	35.25	136.97
Kawagoe	Japan	35.91	139.49
Kawaguchi	Japan	35.81	139.71
Kawasaki	Japan	35.52	139.72
Kitakyushu	Japan	33.85	130.85
Kobe	Japan	34.69	135.18
Kochi	Japan	33.55	133.53
Kōfu	Japan	35.67	138.57
Kōriyama	Japan	37.40	140.38
Koshigaya	Japan	35.89	139.79
Kumamoto	Japan	32.81	130.69
Kurashiki	Japan	34.58	133.77
Kyoto	Japan	35.02	135.75
Machida	Japan	35.54	139.45
Maebashi	Japan	36.40	139.08
Matsudo	Japan	35.78	139.90
Matsue	Japan	35.48	133.05
Matsuyama	Japan	33.84	132.77
Minato	Japan	34.22	135.15
Mito	Japan	36.35	140.45
Miyazaki	Japan	31.92	131.42
Morioka	Japan	39.70	141.15
Nagano	Japan	36.65	138.18
Nagasaki	Japan	32.75	129.88
Nagoya	Japan	35.18	136.91
Naha	Japan	26.22	127.68
Nara-shi	Japan	34.69	135.80
Niigata	Japan	37.89	139.01
Nishinomiya-hama	Japan	34.72	135.33
Ōita	Japan	33.23	131.60
Okayama	Japan	34.65	133.93
Okazaki	Japan	34.95	137.17
Osaka	Japan	34.69	135.50
Ōtsu	Japan	35.00	135.87
Saga	Japan	33.23	130.30
Saitama	Japan	35.91	139.66
Sakai	Japan	34.58	135.47
Sapporo	Japan	43.07	141.35
Sendai	Japan	38.27	140.87
Shizuoka	Japan	34.98	138.38
Suita	Japan	34.76	135.52
Takamatsu	Japan	34.33	134.05
Takatsuki	Japan	34.85	135.62
Tokorozawa	Japan	35.80	139.47
Tokushima	Japan	34.07	134.57
Tokyo	Japan	35.69	139.69
Tottori	Japan	35.50	134.23
Toyama	Japan	36.70	137.22
Toyohashi	Japan	34.77	137.38
Toyonaka	Japan	34.78	135.47
Toyota	Japan	35.08	137.15
Tsu	Japan	34.73	136.52
Utsunomiya	Japan	36.57	139.88
Wakayama	Japan	34.23	135.17
Yamagata	Japan	38.23	140.37
Yamaguchi	Japan	34.18	131.47
Yao	Japan	34.62	135.60
Yokkaichi	Japan	34.97	136.62
Yokohama	Japan	35.43	139.65
Yokosuka	Japan	35.28	139.67
Yono	Japan	35.88	139.63
Saint Helier	Jersey	49.19	-2.10
‘Ajlūn	Jordan	32.33	35.75
Amman	Jordan	31.96	35.95
Aqaba	Jordan	29.53	35.01
As Salţ	Jordan	32.04	35.73
Aţ Ţafīlah	Jordan	30.84	35.60
Irbid	Jordan	32.56	35.85
Jarash	Jordan	32.28	35.90
Ma'an	Jordan	30.20	35.73
Mādabā	Jordan	31.72	35.79
Mafraq	Jordan	32.34	36.21
Russeifa	Jordan	32.02	36.05
Zarqa	Jordan	32.07	36.09
Aktau	Kazakhstan	43.65	51.17
Aktobe	Kazakhstan	50.28	57.21
Almaty	Kazakhstan	43.26	76.93
Atyrau	Kazakhstan	47.12	51.88
Baikonur	Kazakhstan	45.62	63.32
Karagandy	Kazakhstan	49.80	73.10
Kokshetau	Kazakhstan	53.28	69.40
Kostanay	Kazakhstan	53.21	63.62
Kyzylorda	Kazakhstan	44.85	65.51
Nur-Sultan	Kazakhstan	51.18	71.45
Oral	Kazakhstan	51.23	51.37
Pavlodar	Kazakhstan	52.28	76.97
Petropavl	Kazakhstan	54.87	69.15
Semey	Kazakhstan	50.43	80.27
Shymkent	Kazakhstan	42.30	69.60
Taldykorgan	Kazakhstan	45.02	78.37
Taraz	Kazakhstan	42.90	71.37
Turkestan	Kazakhstan	43.30	68.25
Ust-Kamenogorsk	Kazakhstan	49.97	82.61
Bungoma	Kenya	0.56	34.56
Busia	Kenya	0.46	34.11
Eldoret	Kenya	0.52	35.27
Embu	Kenya	-0.54	37.46
Garissa	Kenya	-0.45	39.65
Homa Bay	Kenya	-0.53	34.46
Isiolo	Kenya	0.35	37.58
Iten	Kenya	0.67	35.51
Kakamega	Kenya	0.28	34.75
Kapenguria	Kenya	1.24	35.11
Kericho	Kenya	-0.37	35.28
Kilifi	Kenya	-3.63	39.85
Kisii	Kenya	-0.68	34.77
Kisumu	Kenya	-0.10	34.76
Kitale	Kenya	1.02	35.01
Machakos	Kenya	-1.52	37.27
Mandera	Kenya	3.94	41.86
Meru	Kenya	0.05	37.66
Migori	Kenya	-1.06	34.47
Mombasa	Kenya	-4.05	39.66
Nairobi	Kenya	-1.28	36.82
Nakuru	Kenya	-0.31	36.07
Narok	Kenya	-1.08	35.87
Nyeri	Kenya	-0.42	36.95
Ol Kalou	Kenya	-0.27	36.38
Wajir	Kenya	1.75	40.06
Tarawa	Kiribati	1.33	172.98
Ferizaj	Kosovo	42.37	21.16
Gjakovë	Kosovo	42.38	20.43
Gjilan	Kosovo	42.46	21.47
Mitrovicë	Kosovo	42.88	20.87
Peć	Kosovo	42.66	20.29
Pristina	Kosovo	42.67	21.17
Prizren	Kosovo	42.21	20.74
Topeka	KS	39.05	-95.68
Wichita	KS	37.69	-97.34
Al Aḩmadī	Kuwait	29.08	48.08
Al Farwānīyah	Kuwait	29.28	47.96
Ḩawallī	Kuwait	29.33	48.03
Kuwait City	Kuwait	29.37	47.98
Frankfort	KY	38.20	-84.87
Ironville	KY	38.46	-82.69
Lexington-Fayette	KY	38.05	-84.46
Meads	KY	38.41	-82.71
Bishkek	Kyrgyzstan	42.87	74.59
Jalal-Abad	Kyrgyzstan	40.93	73.00
Karakol	Kyrgyzstan	42.49	78.39
Naryn	Kyrgyzstan	41.43	75.99
Osh	Kyrgyzstan	40.53	72.80
Talas	Kyrgyzstan	42.52	72.24
Baton Rouge	LA	30.44	-91.19
New Orleans	LA	29.95	-90.08
Luang Prabang	Laos	19.89	102.14
Muang Phônsavan	Laos	19.45	103.19
Muang Xay	Laos	20.69	101.98
Pakse	Laos	15.12	105.80
Savannakhet	Laos	16.57	104.76
Thakhèk	Laos	17.41	104.83
Vientiane	Laos	17.97	102.60
Xam Nua	Laos	20.42	104.05
Daugavpils	Latvia	55.88	26.53
Jēkabpils	Latvia	56.50	25.86
Jelgava	Latvia	56.65	23.71
Jūrmala	Latvia	56.97	23.77
Liepāja	Latvia	56.50	21.01
Ogre	Latvia	56.82	24.61
Rēzekne	Latvia	56.51	27.34
Riga	Latvia	56.95	24.11
Valmiera	Latvia	57.54	25.43
Ventspils	Latvia	57.39	21.56
Baalbek	Lebanon	34.01	36.22
Beirut	Lebanon	33.89	35.50
Nabatîyé et Tahta	Lebanon	33.38	35.48
Ra’s Bayrūt	Lebanon	33.90	35.48
Sidon	Lebanon	33.56	35.37
Tripoli	Lebanon	34.43	35.84
Zahlé	Lebanon	33.85	35.90
Leribe	Lesotho	-28.87	28.05
Mafeteng	Lesotho	-29.82	27.24
Maseru	Lesotho	-29.32	27.48
Mohale’s Hoek	Lesotho	-30.15	27.48
Qacha’s Nek	Lesotho	-30.12	28.69
Bensonville	Liberia	6.45	-10.61
Buchanan	Liberia	5.88	-10.05
Gbarnga	Liberia	7.00	-9.47
Harper	Liberia	4.38	-7.71
Kakata	Liberia	6.53	-10.35
Monrovia	Liberia	6.30	-10.80
Voinjama	Liberia	8.42	-9.75
Zwedru	Liberia	6.07	-8.14
Ajdabiya	Libya	30.76	20.23
Al Bayḑā’	Libya	32.76	21.76
Al Khums	Libya	32.65	14.26
Al Marj	Libya	32.49	20.83
Az Zāwīyah	Libya	32.76	12.73
Benghazi	Libya	32.11	20.07
Darnah	Libya	32.77	22.64
Gharyan	Libya	32.17	13.02
Mişrātah	Libya	32.38	15.09
Murzuq	Libya	25.92	13.92
Nālūt	Libya	31.87	10.98
Sabhā	Libya	27.04	14.43
Sirte	Libya	31.21	16.59
Tobruk	Libya	32.09	23.95
Tripoli	Libya	32.89	13.19
Ubari	Libya	26.59	12.78
Zuwārah	Libya	32.93	12.08
Vaduz	Liechtenstein	47.14	9.52
Alytus	Lithuania	54.40	24.04
Kaunas	Lithuania	54.90	23.91
Klaipėda	Lithuania	55.71	21.14
Marijampolė	Lithuania	54.56	23.35
Panevėžys	Lithuania	55.73	24.35
Šiauliai	Lithuania	55.93	23.32
Taurage	Lithuania	55.25	22.29
Telsiai	Lithuania	55.98	22.25
Utena	Lithuania	55.50	25.60
Vilnius	Lithuania	54.69	25.28
Luxembourg	Luxembourg	49.61	6.13
Boston	MA	42.36	-71.06
Macau	Macao SAR China	22.20	113.55
Ambatondrazaka	Madagascar	-17.83	48.42
Ambositra	Madagascar	-20.53	47.24
Ambovombe	Madagascar	-25.18	46.09
Antananarivo	Madagascar	-18.91	47.54
Antsirabe	Madagascar	-19.87	47.03
Antsiranana	Madagascar	-12.32	49.29
Fianarantsoa	Madagascar	-21.45	47.09
Mahajanga	Madagascar	-15.72	46.32
Manakara	Madagascar	-22.15	48.01
Morondava	Madagascar	-20.29	44.32
Sambava	Madagascar	-14.27	50.17
Toamasina	Madagascar	-18.15	49.40
Tôlanaro	Madagascar	-25.03	46.98
Toliara	Madagascar	-23.35	43.67
Tsiroanomandidy	Madagascar	-18.77	46.05
Blantyre	Malawi	-15.78	35.01
Lilongwe	Malawi	-13.97	33.79
Mzuzu	Malawi	-11.47	34.02
Alor Setar	Malaysia	6.12	100.36
George Town	Malaysia	5.41	100.34
Ipoh	Malaysia	4.58	101.08
Johor Bahru	Malaysia	1.47	103.76
Kampung Baru Subang	Malaysia	3.15	101.53
Kangar	Malaysia	6.44	100.20
Klang	Malaysia	3.04	101.44
Kota Bharu	Malaysia	6.12	102.24
Kota Kinabalu	Malaysia	5.97	116.07
Kuala Lumpur	Malaysia	3.14	101.69
Kuala Terengganu	Malaysia	5.33	103.14
Kuantan	Malaysia	3.81	103.33
Kuching	Malaysia	1.55	110.33
Labuan	Malaysia	5.28	115.25
Malacca	Malaysia	2.20	102.24
Petaling Jaya	Malaysia	3.11	101.61
Sandakan	Malaysia	5.84	118.12
Seremban	Malaysia	2.73	101.94
Shah Alam	Malaysia	3.09	101.53
Subang Jaya	Malaysia	3.04	101.58
Tawau	Malaysia	4.24	117.89
Male	Maldives	4.18	73.51
Bamako	Mali	12.65	-8.00
Gao	Mali	16.27	-0.04
Kayes	Mali	14.45	-11.44
Mopti	Mali	14.48	-4.18
Ségou	Mali	13.43	-6.22
Sikasso	Mali	11.32	-5.67
Timbuktu	Mali	16.77	-3.01
Valletta	Malta	35.90	14.51
Majuro	Marshall Islands	7.09	171.38
Fort-de-France	Martinique	14.60	-61.07
South Boston	MA	42.33	-71.05
Kaédi	Mauritania	16.15	-13.50
Kiffa	Mauritania	16.62	-11.40
Néma	Mauritania	16.62	-7.26
Nouadhibou	Mauritania	20.94	-17.04
Nouakchott	Mauritania	18.09	-15.98
Rosso	Mauritania	16.51	-15.81
Zouerate	Mauritania	22.74	-12.47
Beau Bassin-Rose Hill	Mauritius	-20.23	57.47
Port Louis	Mauritius	-20.16	57.50
Mamoudzou	Mayotte	-12.78	45.23
Winnipeg	MB	49.88	-97.15
Annapolis	MD	38.98	-76.49
Baltimore	MD	39.29	-76.61
Acapulco de Juárez	Mexico	16.85	-99.91
Aguascalientes	Mexico	21.88	-102.28
Álvaro Obregón	Mexico	19.36	-99.20
Azcapotzalco	Mexico	19.49	-99.19
Benito Juarez	Mexico	19.40	-99.16
Benito Juárez	Mexico	19.37	-99.16
Campeche	Mexico	19.84	-90.53
Cancún	Mexico	21.17	-86.85
Celaya	Mexico	20.52	-100.82
Chetumal	Mexico	18.51	-88.30
Chihuahua	Mexico	28.64	-106.09
Chilpancingo	Mexico	17.55	-99.51
Ciudad Apodaca	Mexico	25.78	-100.19
Ciudad General Escobedo	Mexico	25.80	-100.32
Ciudad López Mateos	Mexico	19.56	-99.26
Ciudad Nezahualcoyotl	Mexico	19.40	-99.01
Ciudad Obregón	Mexico	27.49	-109.94
Ciudad Victoria	Mexico	23.74	-99.15
Coacalco	Mexico	19.63	-99.11
Colima	Mexico	19.25	-103.73
Colonia del Valle	Mexico	19.39	-99.16
Coyoacán	Mexico	19.35	-99.16
Cuauhtémoc	Mexico	19.45	-99.15
Cuautitlán Izcalli	Mexico	19.64	-99.22
Cuernavaca	Mexico	18.93	-99.23
Culiacán	Mexico	24.79	-107.39
Ecatepec de Morelos	Mexico	19.60	-99.06
Ensenada	Mexico	31.87	-116.60
Gómez Palacio	Mexico	25.57	-103.50
Guadalajara	Mexico	20.67	-103.39
Guadalupe	Mexico	25.68	-100.26
Guanajuato	Mexico	21.02	-101.26
Gustavo Adolfo Madero	Mexico	19.49	-99.11
Hermosillo	Mexico	29.10	-110.98
Heroica Matamoros	Mexico	25.88	-97.50
Irapuato	Mexico	20.68	-101.36
Ixtapaluca	Mexico	19.32	-98.88
Iztacalco	Mexico	19.40	-99.10
Iztapalapa	Mexico	19.36	-99.06
Juárez	Mexico	31.72	-106.46
La Paz	Mexico	24.14	-110.30
León de los Aldama	Mexico	21.13	-101.67
Los Mochis	Mexico	25.79	-109.00
Mazatlán	Mexico	23.23	-106.41
Mérida	Mexico	20.98	-89.62
Mexicali	Mexico	32.63	-115.45
Mexico City	Mexico	19.43	-99.13
Miguel Hidalgo	Mexico	19.43	-99.20
Monterrey	Mexico	25.68	-100.32
Morelia	Mexico	19.70	-101.18
Naucalpan de Juárez	Mexico	19.48	-99.24
Nicolás Romero	Mexico	19.64	-99.31
Nuevo Laredo	Mexico	27.48	-99.52
Oaxaca	Mexico	17.07	-96.72
Pachuca de Soto	Mexico	20.12	-98.73
Puebla	Mexico	19.04	-98.20
Reynosa	Mexico	26.08	-98.29
Saltillo	Mexico	25.42	-101.01
San Luis Potosí	Mexico	22.15	-100.98
San Nicolás de los Garza	Mexico	25.74	-100.30
Santa Catarina	Mexico	25.67	-100.46
Santa María Chimalhuacán	Mexico	19.42	-98.95
Santiago de Querétaro	Mexico	20.59	-100.39
Soledad de Graciano Sánchez	Mexico	22.19	-100.94
Tampico	Mexico	22.29	-97.88
Tepic	Mexico	21.51	-104.90
Tijuana	Mexico	32.50	-117.00
Tláhuac	Mexico	19.29	-99.01
Tlalnepantla	Mexico	19.54	-99.20
Tlalpan	Mexico	19.30	-99.16
Tlaquepaque	Mexico	20.64	-103.29
Tlaxcala	Mexico	19.32	-98.20
Toluca	Mexico	19.29	-99.65
Tonalá	Mexico	20.62	-103.23
Torreón	Mexico	25.54	-103.42
Tuxtla	Mexico	16.76	-93.11
Uruapan	Mexico	19.41	-102.06
Venustiano Carranza	Mexico	19.44	-99.10
Veracruz	Mexico	19.18	-96.14
Victoria de Durango	Mexico	24.02	-104.66
Villahermosa	Mexico	17.99	-92.93
Xalapa de Enríquez	Mexico	19.53	-96.92
Xico	Mexico	19.27	-98.95
Xochimilco	Mexico	19.25	-99.10
Zacatecas	Mexico	22.77	-102.58
Zapopan	Mexico	20.72	-103.38
Palikir - National Government Center	Micronesia	6.92	158.16
Detroit	MI	42.33	-83.05
Lansing	MI	42.73	-84.56
Minneapolis	MN	44.98	-93.26
Saint Paul	MN	44.94	-93.09
Jefferson City	MO	38.58	-92.17
Kansas City	MO	39.10	-94.58
Bălţi	Moldova	47.76	27.93
Bender	Moldova	46.83	29.48
Cahul	Moldova	45.90	28.20
Chisinau	Moldova	47.01	28.86
Soroca	Moldova	48.16	28.28
Tiraspol	Moldova	46.84	29.63
Ungheni	Moldova	47.21	27.80
Monaco	Monaco	43.73	7.42
Arvayheer	Mongolia	46.26	102.78
Bayanhongor	Mongolia	46.19	100.72
Darhan	Mongolia	49.49	105.92
Erdenet	Mongolia	49.03	104.08
Khovd	Mongolia	48.01	91.64
Murun-kuren	Mongolia	49.63	100.16
Ölgii	Mongolia	48.97	89.96
Ulaangom	Mongolia	49.98	92.07
Ulan Bator	Mongolia	47.91	106.88
Nikšić	Montenegro	42.77	18.94
Podgorica	Montenegro	42.44	19.26
Plymouth	Montserrat	16.71	-62.21
Agadir	Morocco	30.42	-9.60
Al Hoceïma	Morocco	35.25	-3.94
Beni Mellal	Morocco	32.34	-6.35
Casablanca	Morocco	33.59	-7.61
Fès	Morocco	34.03	-5.00
Guelmim	Morocco	28.99	-10.06
Kenitra	Morocco	34.26	-6.58
Marrakesh	Morocco	31.63	-8.00
Meknès	Morocco	33.89	-5.55
Oujda-Angad	Morocco	34.68	-1.91
Rabat	Morocco	34.01	-6.83
Safi	Morocco	32.30	-9.24
Sale	Morocco	34.05	-6.80
Tangier	Morocco	35.77	-5.80
Temara	Morocco	33.93	-6.91
Tétouan	Morocco	35.58	-5.37
St. Louis	MO	38.63	-90.20
Beira	Mozambique	-19.84	34.84
Chimoio	Mozambique	-19.12	33.48
Inhambane	Mozambique	-23.86	35.38
Lichinga	Mozambique	-13.31	35.24
Maputo	Mozambique	-25.97	32.58
Matola	Mozambique	-25.96	32.46
Nampula	Mozambique	-15.12	39.27
Pemba	Mozambique	-12.97	40.52
Quelimane	Mozambique	-17.88	36.89
Tete	Mozambique	-16.16	33.59
Xai-Xai	Mozambique	-25.05	33.64
Jackson	MS	32.30	-90.18
Helena	MT	46.59	-112.04
Bago	Myanmar (Burma)	17.34	96.48
Dawei	Myanmar (Burma)	14.08	98.19
Hpa-An	Myanmar (Burma)	16.89	97.63
Magway	Myanmar (Burma)	20.15	94.93
Mandalay	Myanmar (Burma)	21.97	96.08
Mawlamyine	Myanmar (Burma)	16.49	97.63
Myitkyina	Myanmar (Burma)	25.38	97.40
Nay Pyi Taw	Myanmar (Burma)	19.75	96.13
Pathein	Myanmar (Burma)	16.78	94.73
Sagaing	Myanmar (Burma)	21.88	95.98
Sittwe	Myanmar (Burma)	20.15	92.90
Taunggyi	Myanmar (Burma)	20.79	97.04
Yangon	Myanmar (Burma)	16.81	96.16
Katima Mulilo	Namibia	-17.50	24.27
Oshakati	Namibia	-17.79	15.70
Rundu	Namibia	-17.93	19.77
Swakopmund	Namibia	-22.68	14.53
Windhoek	Namibia	-22.56	17.08
Yaren	Nauru	-0.55	166.93
Fredericton	NB	45.95	-66.67
Charlotte	NC	35.23	-80.84
Durham	NC	35.99	-78.90
Greensboro	NC	36.07	-79.79
Raleigh	NC	35.77	-78.64
West Raleigh	NC	35.79	-78.66
Bismarck	ND	46.81	-100.78
Lincoln	NE	40.80	-96.67
Omaha	NE	41.26	-95.94
Birendranagar	Nepal	28.60	81.63
Kathmandu	Nepal	27.70	85.32
Pokhara	Nepal	28.27	83.97
's-Hertogenbosch	Netherlands	51.70	5.30
Amsterdam	Netherlands	52.37	4.89
Arnhem	Netherlands	51.98	5.91
Assen	Netherlands	53.00	6.56
Groningen	Netherlands	53.22	6.57
Haarlem	Netherlands	52.38	4.64
Leeuwarden	Netherlands	53.20	5.81
Lelystad	Netherlands	52.51	5.47
Maastricht	Netherlands	50.85	5.69
Middelburg	Netherlands	51.50	3.61
Rotterdam	Netherlands	51.92	4.48
The Hague	Netherlands	52.08	4.30
Utrecht	Netherlands	52.09	5.12
Zwolle	Netherlands	52.51	6.09
Nouméa	New Caledonia	-22.27	166.45
Auckland	New Zealand	-36.85	174.76
Blenheim	New Zealand	-41.52	173.95
Christchurch	New Zealand	-43.53	172.63
Dunedin	New Zealand	-45.87	170.50
Gisborne	New Zealand	-38.65	178.00
Hamilton	New Zealand	-37.78	175.28
Invercargill	New Zealand	-46.40	168.35
Manukau City	New Zealand	-36.99	174.88
Napier	New Zealand	-39.49	176.91
Nelson	New Zealand	-41.27	173.28
New Plymouth	New Zealand	-39.07	174.08
Palmerston North	New Zealand	-40.36	175.61
Wellington	New Zealand	-41.29	174.78
Whangarei	New Zealand	-35.73	174.32
Concord	NH	43.21	-71.54
Bluefields	Nicaragua	12.01	-83.76
Boaco	Nicaragua	12.47	-85.66
Chinandega	Nicaragua	12.63	-87.13
Estelí	Nicaragua	13.09	-86.35
Granada	Nicaragua	11.93	-85.96
Jinotega	Nicaragua	13.09	-86.00
Jinotepe	Nicaragua	11.85	-86.20
Juigalpa	Nicaragua	12.11	-85.36
León	Nicaragua	12.44	-86.88
Managua	Nicaragua	12.13	-86.25
Masaya	Nicaragua	11.97	-86.09
Matagalpa	Nicaragua	12.93	-85.92
Ocotal	Nicaragua	13.63	-86.48
Puerto Cabezas	Nicaragua	14.04	-83.39
Rivas	Nicaragua	11.44	-85.83
Agadez	Niger	16.97	7.99
Diffa	Niger	13.32	12.61
Dosso	Niger	13.05	3.19
Aba	Nigeria	5.11	7.37
Abakaliki	Nigeria	6.32	8.11
Abeokuta	Nigeria	7.16	3.35
Abuja	Nigeria	9.06	7.50
Ado-Ekiti	Nigeria	7.62	5.22
Akure	Nigeria	7.25	5.19
Asaba	Nigeria	6.20	6.73
Awka	Nigeria	6.21	7.07
Bauchi	Nigeria	10.31	9.84
Benin City	Nigeria	6.34	5.63
Birnin Kebbi	Nigeria	12.45	4.20
Calabar	Nigeria	4.96	8.33
Damaturu	Nigeria	11.75	11.96
Ebute Ikorodu	Nigeria	6.60	3.49
Efon-Alaaye	Nigeria	7.66	4.92
Enugu	Nigeria	6.44	7.50
Gombe	Nigeria	10.29	11.17
Gusau	Nigeria	12.17	6.66
Ibadan	Nigeria	7.38	3.91
Ikeja	Nigeria	6.60	3.34
Ikot Ekpene	Nigeria	5.18	7.71
Ilesa	Nigeria	7.63	4.74
Ilorin	Nigeria	8.50	4.54
Iwo	Nigeria	7.64	4.18
Jalingo	Nigeria	8.89	11.36
Jos	Nigeria	9.93	8.89
Kaduna	Nigeria	10.53	7.44
Kano	Nigeria	12.00	8.52
Katsina	Nigeria	12.99	7.60
Lafia	Nigeria	8.49	8.52
Lagos	Nigeria	6.45	3.39
Lekki	Nigeria	6.41	4.09
Lokoja	Nigeria	7.80	6.74
Maiduguri	Nigeria	11.85	13.16
Makurdi	Nigeria	7.73	8.52
Minna	Nigeria	9.62	6.55
Okene	Nigeria	7.55	6.24
Ondo	Nigeria	7.09	4.84
Onitsha	Nigeria	6.15	6.79
Osogbo	Nigeria	7.77	4.56
Owerri	Nigeria	5.48	7.03
Owo	Nigeria	7.20	5.59
Oyo	Nigeria	7.85	3.93
Port Harcourt	Nigeria	4.78	7.01
Sokoto	Nigeria	13.06	5.24
Umuahia	Nigeria	5.52	7.49
Uyo	Nigeria	5.05	7.93
Warri	Nigeria	5.52	5.75
Yola	Nigeria	9.21	12.48
Zaria	Nigeria	11.11	7.72
Maradi	Niger	13.50	7.10
Niamey	Niger	13.51	2.11
Tahoua	Niger	14.89	5.27
Zinder	Niger	13.81	8.99
Alofi	Niue	-19.05	-169.92
Jersey City	NJ	40.73	-74.08
Newark	NJ	40.74	-74.17
Trenton	NJ	40.22	-74.74
St. John's	NL	47.56	-52.71
Albuquerque	NM	35.08	-106.65
Santa Fe	NM	35.69	-105.94
Kingston	Norfolk Island	-29.05	167.97
Chongjin	North Korea	41.80	129.78
Haeju	North Korea	38.04	125.71
Hamhŭng	North Korea	39.92	127.54
Hŭngnam	North Korea	39.83	127.62
Kaesŏng	North Korea	37.97	126.55
Kanggye	North Korea	40.97	126.59
Namp’o	North Korea	38.74	125.41
P’yŏngsŏng	North Korea	39.25	125.87
Pyongyang	North Korea	39.03	125.75
Rajin	North Korea	42.26	130.28
Sariwŏn	North Korea	38.51	125.76
Sinŭiju	North Korea	40.10	124.40
Sunch’ŏn	North Korea	39.43	125.93
Wŏnsan	North Korea	39.15	127.44
Bitola	North Macedonia	41.03	21.33
Centar Župa	North Macedonia	41.48	20.56
Gostivar	North Macedonia	41.80	20.91
Kavadarci	North Macedonia	41.43	22.01
Kičevo	North Macedonia	41.51	20.96
Kochani	North Macedonia	41.92	22.41
Kumanovo	North Macedonia	42.13	21.71
Lipkovo	North Macedonia	42.16	21.59
Ohrid	North Macedonia	41.12	20.80
Prilep	North Macedonia	41.35	21.56
Shtip	North Macedonia	41.75	22.20
Skopje	North Macedonia	42.00	21.43
Struga	North Macedonia	41.18	20.68
Strumica	North Macedonia	41.44	22.64
Tetovo	North Macedonia	42.01	20.97
Veles	North Macedonia	41.72	21.78
Zelino	North Macedonia	41.98	21.06
Saipan	Northern Mariana Islands	15.21	145.75
Arendal	Norway	58.46	8.77
Bergen	Norway	60.39	5.32
Bodø	Norway	67.28	14.41
Drammen	Norway	59.74	10.20
Hamar	Norway	60.79	11.07
Kristiansand	Norway	58.15	8.00
Oslo	Norway	59.91	10.75
Sarpsborg	Norway	59.28	11.11
Skien	Norway	59.21	9.61
Stavanger	Norway	58.97	5.73
Tønsberg	Norway	59.27	10.41
Tromsø	Norway	69.65	18.96
Halifax	NS	44.65	-63.57
Carson City	NV	39.16	-119.77
Henderson	NV	36.04	-114.98
Las Vegas	NV	36.17	-115.14
Albany	NY	42.65	-73.76
Brooklyn	NY	40.65	-73.95
Buffalo	NY	42.89	-78.88
Manhattan	NY	40.78	-73.97
New York City	NY	40.71	-74.01
Queens	NY	40.68	-73.84
Staten Island	NY	40.56	-74.14
The Bronx	NY	40.85	-73.87
Cincinnati	OH	39.13	-84.51
Cleveland	OH	41.50	-81.70
Columbus	OH	39.96	-83.00
Toledo	OH	41.66	-83.56
Oklahoma City	OK	35.47	-97.52
Tulsa	OK	36.15	-95.99
Al Buraymī	Oman	24.25	55.79
Ibrā’	Oman	22.69	58.53
Muscat	Oman	23.58	58.41
Nizwá	Oman	22.93	57.53
Şalālah	Oman	17.02	54.09
Sohar	Oman	24.35	56.71
Sur	Oman	22.57	59.53
Brampton	ON	43.68	-79.77
Etobicoke	ON	43.65	-79.57
Hamilton	ON	43.25	-79.85
London	ON	42.98	-81.23
Markham	ON	43.87	-79.27
Mississauga	ON	43.58	-79.66
North York	ON	43.77	-79.42
Oshawa	ON	43.90	-78.85
Ottawa	ON	45.41	-75.70
Scarborough	ON	43.77	-79.26
Toronto	ON	43.70	-79.42
Windsor	ON	42.30	-83.02
Portland	OR	45.52	-122.68
Salem	OR	44.94	-123.04
Harrisburg	PA	40.27	-76.88
Bahawalpur	Pakistan	29.40	71.68
Battagram	Pakistan	34.68	73.02
Bhimbar	Pakistan	32.97	74.08
Faisalabad	Pakistan	31.42	73.09
Gujranwala	Pakistan	32.16	74.19
Gujrat	Pakistan	32.57	74.08
Hyderabad	Pakistan	25.39	68.37
Islamabad	Pakistan	33.72	73.04
Jhang Sadr	Pakistan	31.27	72.32
Karachi	Pakistan	24.86	67.01
Kasur	Pakistan	31.12	74.45
Kotli	Pakistan	33.52	73.90
Lahore	Pakistan	31.56	74.35
Larkana	Pakistan	27.56	68.21
Malir Cantonment	Pakistan	24.94	67.21
Mardan	Pakistan	34.20	72.05
Mingora	Pakistan	34.78	72.36
Multan	Pakistan	30.20	71.48
Muzaffarābād	Pakistan	34.37	73.47
Peshawar	Pakistan	34.01	71.58
Quetta	Pakistan	30.18	67.00
Rahim Yar Khan	Pakistan	28.42	70.30
Rawalpindi	Pakistan	33.60	73.05
Sargodha	Pakistan	32.09	72.67
Shekhupura	Pakistan	31.71	73.99
Sialkot	Pakistan	32.49	74.53
Sukkur	Pakistan	27.70	68.86
Ngerulmud	Palau	7.50	134.62
East Jerusalem	Palestinian Territories	31.78	35.23
Gaza	Palestinian Territories	31.50	34.47
Colón	Panama	9.35	-79.90
David	Panama	8.43	-82.43
La Chorrera	Panama	8.88	-79.78
Panamá	Panama	8.99	-79.52
San Miguelito	Panama	9.05	-79.47
Santiago de Veraguas	Panama	8.10	-80.98
Philadelphia	PA	39.95	-75.16
Pittsburgh	PA	40.44	-80.00
Kokopo	Papua New Guinea	-4.34	152.27
Lae	Papua New Guinea	-6.72	147.00
Madang	Papua New Guinea	-5.22	145.79
Mendi	Papua New Guinea	-6.15	143.66
Mount Hagen	Papua New Guinea	-5.86	144.23
Popondetta	Papua New Guinea	-8.77	148.23
Port Moresby	Papua New Guinea	-9.48	147.15
Asunción	Paraguay	-25.29	-57.65
Ciudad del Este	Paraguay	-25.51	-54.61
Concepción	Paraguay	-23.40	-57.43
Coronel Oviedo	Paraguay	-25.44	-56.44
Encarnación	Paraguay	-27.33	-55.87
Pedro Juan Caballero	Paraguay	-22.55	-55.73
Pilar	Paraguay	-26.86	-58.31
Villa Hayes	Paraguay	-25.09	-57.52
Villarrica	Paraguay	-25.75	-56.44
Charlottetown	PE	46.23	-63.13
Abancay	Peru	-13.63	-72.88
Arequipa	Peru	-16.40	-71.53
Ayacucho	Peru	-13.16	-74.22
Cajamarca	Peru	-7.16	-78.50
Callao	Peru	-12.06	-77.12
Cerro de Pasco	Peru	-10.67	-76.26
Chiclayo	Peru	-6.77	-79.84
Chimbote	Peru	-9.09	-78.58
Cusco	Peru	-13.52	-71.97
Huacho	Peru	-11.11	-77.61
Huancavelica	Peru	-12.78	-74.97
Huancayo	Peru	-12.07	-75.20
Huánuco	Peru	-9.93	-76.24
Huaraz	Peru	-9.53	-77.53
Ica	Peru	-14.07	-75.73
Iquitos	Peru	-3.75	-73.25
Lima	Peru	-12.04	-77.03
Moquegua	Peru	-17.20	-70.94
Moyobamba	Peru	-6.03	-76.97
Piura	Peru	-5.19	-80.63
Pucallpa	Peru	-8.38	-74.55
Puerto Maldonado	Peru	-12.59	-69.19
Puno	Peru	-15.84	-70.02
Santiago de Surco	Peru	-12.14	-77.01
Tacna	Peru	-18.01	-70.25
Trujillo	Peru	-8.12	-79.03
Tumbes	Peru	-3.57	-80.45
Angeles City	Philippines	15.15	120.58
Antipolo	Philippines	14.63	121.12
Bacolod City	Philippines	10.67	122.95
Bacoor	Philippines	14.46	120.94
Baguio	Philippines	16.42	120.59
Biñan	Philippines	14.34	121.08
Budta	Philippines	7.20	124.44
Butuan	Philippines	8.95	125.54
Cabuyao	Philippines	14.27	121.13
Cagayan de Oro	Philippines	8.48	124.65
Cainta	Philippines	14.58	121.12
Calamba	Philippines	14.21	121.17
Calapan	Philippines	13.41	121.18
Caloocan City	Philippines	14.65	120.97
Cebu City	Philippines	10.32	123.89
Cotabato	Philippines	7.22	124.25
Dasmariñas	Philippines	14.33	120.94
Davao	Philippines	7.07	125.61
General Santos	Philippines	6.11	125.17
Iligan	Philippines	8.23	124.24
Iligan City	Philippines	8.25	124.40
Iloilo	Philippines	10.70	122.56
Koronadal	Philippines	6.50	124.85
Lapu-Lapu City	Philippines	10.31	123.95
Las Piñas	Philippines	14.45	120.98
Libertad	Philippines	8.94	125.50
Makati City	Philippines	14.55	121.03
Malingao	Philippines	7.16	124.47
Mandaluyong City	Philippines	14.58	121.04
Mandaue City	Philippines	10.32	123.92
Manila	Philippines	14.60	120.98
Mansilingan	Philippines	10.63	122.98
Mantampay	Philippines	8.17	124.22
Pagadian	Philippines	7.83	123.44
Pasay	Philippines	14.54	121.00
Pasig City	Philippines	14.59	121.06
Quezon City	Philippines	14.65	121.05
San Fernando	Philippines	15.03	120.68
San Jose del Monte	Philippines	14.81	121.05
San Pedro	Philippines	14.36	121.05
Santol	Philippines	15.16	120.57
Taguig	Philippines	14.52	121.08
Tuguegarao	Philippines	17.62	121.72
Zamboanga	Philippines	6.91	122.07
Adamstown	Pitcairn Islands	-25.07	-130.10
Białystok	Poland	53.13	23.16
Bydgoszcz	Poland	53.12	18.01
Gdańsk	Poland	54.35	18.65
Gdynia	Poland	54.52	18.53
Gorzów Wielkopolski	Poland	52.74	15.23
Katowice	Poland	50.26	19.03
Kielce	Poland	50.87	20.63
Kraków	Poland	50.06	19.94
Łódź	Poland	51.77	19.47
Lublin	Poland	51.25	22.57
Olsztyn	Poland	53.78	20.49
Opole	Poland	50.67	17.93
Poznań	Poland	52.41	16.93
Rzeszów	Poland	50.04	22.00
Szczecin	Poland	53.43	14.55
Warsaw	Poland	52.23	21.01
Wrocław	Poland	51.10	17.03
Zielona Góra	Poland	51.94	15.51
Aveiro	Portugal	40.64	-8.65
Beja	Portugal	38.02	-7.86
Braga	Portugal	41.55	-8.42
Bragança	Portugal	41.81	-6.76
Castelo Branco	Portugal	39.82	-7.49
Coimbra	Portugal	40.21	-8.42
Évora	Portugal	38.57	-7.90
Faro	Portugal	37.02	-7.93
Funchal	Portugal	32.67	-16.93
Guarda	Portugal	40.54	-7.27
Leiria	Portugal	39.74	-8.81
Lisbon	Portugal	38.72	-9.13
Porto	Portugal	41.15	-8.61
Santarém	Portugal	39.23	-8.68
Setúbal	Portugal	38.52	-8.89
Viana do Castelo	Portugal	41.69	-8.83
Viseu	Portugal	40.66	-7.91
Arecibo	Puerto Rico	18.47	-66.72
Bayamón	Puerto Rico	18.40	-66.16
Caguas	Puerto Rico	18.23	-66.05
Carolina	Puerto Rico	18.38	-65.96
Cataño	Puerto Rico	18.44	-66.12
Fajardo	Puerto Rico	18.33	-65.65
Guaynabo	Puerto Rico	18.36	-66.11
Mayagüez	Puerto Rico	18.20	-67.14
Ponce	Puerto Rico	18.01	-66.62
San Juan	Puerto Rico	18.47	-66.11
Trujillo Alto	Puerto Rico	18.35	-66.01
Vega Baja	Puerto Rico	18.44	-66.39
Al Wakrah	Qatar	25.17	51.60
Ar Rayyān	Qatar	25.29	51.42
Doha	Qatar	25.29	51.53
Laval	QC	45.57	-73.69
Montréal	QC	45.51	-73.59
Québec	QC	46.81	-71.21
Saint-Denis	Réunion	-20.88	55.45
Providence	RI	41.82	-71.41
Alba Iulia	Romania	46.07	23.58
Alexandria	Romania	43.98	25.33
Arad	Romania	46.18	21.32
Bacău	Romania	46.57	26.91
Baia Mare	Romania	47.66	23.57
Bistriţa	Romania	47.13	24.50
Botoşani	Romania	47.75	26.67
Brăila	Romania	45.27	27.97
Braşov	Romania	45.65	25.61
Bucharest	Romania	44.43	26.11
Buzău	Romania	45.15	26.83
Cluj-Napoca	Romania	46.77	23.60
Constanţa	Romania	44.18	28.63
Craiova	Romania	44.32	23.80
Drobeta-Turnu Severin	Romania	44.63	22.65
Focșani	Romania	45.70	27.18
Galaţi	Romania	45.44	28.05
Giurgiu	Romania	43.89	25.96
Hunedoara	Romania	45.75	22.90
Iaşi	Romania	47.17	27.60
Miercurea-Ciuc	Romania	46.35	25.80
Oradea	Romania	47.05	21.92
Piatra Neamţ	Romania	46.92	26.33
Piteşti	Romania	44.85	24.87
Ploieşti	Romania	44.95	26.02
Râmnicu Vâlcea	Romania	45.10	24.37
Reşiţa	Romania	45.30	21.89
Satu Mare	Romania	47.80	22.86
Sector 2	Romania	44.45	26.13
Sector 3	Romania	44.42	26.17
Sector 4	Romania	44.38	26.12
Sector 5	Romania	44.39	26.07
Sector 6	Romania	44.44	26.02
Sfântu Gheorghe	Romania	45.87	25.78
Sibiu	Romania	45.80	24.15
Slatina	Romania	44.43	24.37
Slobozia	Romania	44.56	27.36
Suceava	Romania	47.63	26.25
Târgovişte	Romania	44.93	25.46
Târgu Jiu	Romania	45.05	23.28
Târgu-Mureş	Romania	46.54	24.56
Timişoara	Romania	45.75	21.23
Tulcea	Romania	45.18	28.81
Vaslui	Romania	46.63	27.73
Zalău	Romania	47.20	23.05
Abakan	Russia	53.72	91.43
Arkhangel’sk	Russia	64.54	40.54
Astrakhan	Russia	46.35	48.04
Barnaul	Russia	53.36	83.76
Belgorod	Russia	50.61	36.58
Birobidzhan	Russia	48.79	132.92
Blagoveshchensk	Russia	50.28	127.54
Bratsk	Russia	56.13	101.61
Bryansk	Russia	53.25	34.37
Cheboksary	Russia	56.13	47.25
Chelyabinsk	Russia	55.15	61.43
Cherepovets	Russia	59.13	37.90
Cherkessk	Russia	44.22	42.06
Chita	Russia	52.03	113.50
Elista	Russia	46.31	44.26
Gorno-Altaysk	Russia	51.96	85.92
Groznyy	Russia	43.31	45.69
Irkutsk	Russia	52.30	104.30
Ivanovo	Russia	57.00	40.97
Izhevsk	Russia	56.85	53.20
Kaliningrad	Russia	54.71	20.51
Kalininskiy	Russia	60.00	30.39
Kaluga	Russia	54.53	36.28
Kazan	Russia	55.79	49.12
Kemerovo	Russia	55.33	86.08
Khabarovsk	Russia	48.48	135.08
Khabarovsk Vtoroy	Russia	48.44	135.13
Khanty-Mansiysk	Russia	61.00	69.00
Kirov	Russia	58.60	49.66
Komsomolsk-on-Amur	Russia	50.55	137.01
Kostroma	Russia	57.77	40.93
Krasnodar	Russia	45.04	38.98
Krasnogvargeisky	Russia	59.97	30.48
Krasnoyarsk	Russia	56.02	92.87
Kurgan	Russia	55.45	65.33
Kursk	Russia	51.74	36.19
Kyzyl	Russia	51.71	94.45
Lipetsk	Russia	52.60	39.57
Magadan	Russia	59.56	150.80
Magnitogorsk	Russia	53.42	59.05
Makhachkala	Russia	42.98	47.50
Maykop	Russia	44.61	40.11
Moscow	Russia	55.75	37.62
Murmansk	Russia	68.98	33.09
Naberezhnyye Chelny	Russia	55.73	52.41
Nal’chik	Russia	43.50	43.62
Nizhniy Novgorod	Russia	56.33	44.00
Nizhny Tagil	Russia	57.92	59.97
Novokuznetsk	Russia	53.76	87.11
Novosibirsk	Russia	55.04	82.93
Omsk	Russia	54.99	73.37
Orël	Russia	52.97	36.08
Orenburg	Russia	51.77	55.10
Penza	Russia	53.20	45.00
Perm	Russia	58.01	56.25
Petropavlovsk-Kamchatsky	Russia	53.04	158.65
Petrozavodsk	Russia	61.78	34.35
Pskov	Russia	57.81	28.35
Rostov-na-Donu	Russia	47.23	39.72
Ryazan’	Russia	54.63	39.69
Saint Petersburg	Russia	59.94	30.31
Salekhard	Russia	66.53	66.60
Samara	Russia	53.20	50.15
Saransk	Russia	54.18	45.17
Saratov	Russia	51.54	46.01
Smolensk	Russia	54.78	32.04
Sochi	Russia	43.60	39.73
Stavropol’	Russia	45.04	41.97
Sterlitamak	Russia	53.62	55.95
Surgut	Russia	61.25	73.42
Syktyvkar	Russia	61.66	50.81
Taganrog	Russia	47.24	38.90
Tambov	Russia	52.73	41.44
Tol’yatti	Russia	53.53	49.35
Tomsk	Russia	56.50	84.97
Tula	Russia	54.20	37.62
Tver	Russia	56.86	35.90
Tyumen	Russia	57.15	65.53
Ufa	Russia	54.74	55.97
Ulan-Ude	Russia	51.83	107.61
Ulyanovsk	Russia	54.33	48.39
Velikiy Novgorod	Russia	58.52	31.27
Vladikavkaz	Russia	43.04	44.67
Vladimir	Russia	56.14	40.40
Vladivostok	Russia	43.11	131.87
Volgograd	Russia	48.72	44.50
Vologda	Russia	59.22	39.88
Volzhskiy	Russia	48.79	44.78
Voronezh	Russia	51.67	39.18
Yakutsk	Russia	62.03	129.73
Yaroslavl	Russia	57.63	39.87
Yekaterinburg	Russia	56.85	60.61
Yoshkar-Ola	Russia	56.64	47.89
Yuzhno-Sakhalinsk	Russia	46.95	142.74
Byumba	Rwanda	-1.58	30.07
Kibuye	Rwanda	-2.06	29.35
Kigali	Rwanda	-1.95	30.06
Rwamagana	Rwanda	-1.95	30.43
Apia	Samoa	-13.83	-171.77
San Marino	San Marino	43.94	12.45
São Tomé	São Tomé & Príncipe	0.34	6.73
Abha	Saudi Arabia	18.22	42.51
Al Bahah	Saudi Arabia	20.01	41.47
Al Hufūf	Saudi Arabia	25.36	49.59
Al Kharj	Saudi Arabia	24.16	47.33
Al Mubarraz	Saudi Arabia	25.41	49.59
Arar	Saudi Arabia	30.98	41.04
Buraydah	Saudi Arabia	26.33	43.97
Dammam	Saudi Arabia	26.43	50.10
Ha'il	Saudi Arabia	27.52	41.69
Hafar Al-Batin	Saudi Arabia	28.43	45.97
Jeddah	Saudi Arabia	21.49	39.19
Jizan	Saudi Arabia	16.89	42.55
Khamis Mushait	Saudi Arabia	18.30	42.73
Mecca	Saudi Arabia	21.43	39.83
Medina	Saudi Arabia	24.47	39.61
Najrān	Saudi Arabia	17.49	44.13
Riyadh	Saudi Arabia	24.69	46.72
Sakakah	Saudi Arabia	29.97	40.21
Sulţānah	Saudi Arabia	24.49	39.59
Ta’if	Saudi Arabia	21.27	40.42
Tabuk	Saudi Arabia	28.40	36.57
Columbia	SC	34.00	-81.03
Dakar	Senegal	14.69	-17.44
Kaffrine	Senegal	14.11	-15.55
Kaolack	Senegal	14.15	-16.07
Kolda	Senegal	12.89	-14.94
Louga	Senegal	15.62	-16.22
Pikine	Senegal	14.76	-17.39
Saint-Louis	Senegal	16.02	-16.49
Tambacounda	Senegal	13.77	-13.67
Thiès	Senegal	14.79	-16.93
Thiès Nones	Senegal	14.78	-16.97
Touba	Senegal	14.85	-15.88
Ziguinchor	Senegal	12.57	-16.27
Belgrade	Serbia	44.80	20.47
Niš	Serbia	43.32	21.90
Novi Sad	Serbia	45.25	19.84
Victoria	Seychelles	-4.62	55.46
Bo	Sierra Leone	7.96	-11.74
Freetown	Sierra Leone	8.49	-13.24
Kenema	Sierra Leone	7.88	-11.19
Makeni	Sierra Leone	8.89	-12.04
Singapore	Singapore	1.29	103.85
Woodlands	Singapore	1.44	103.79
Philipsburg	Sint Maarten	18.03	-63.05
Regina	SK	50.45	-104.62
Banská Bystrica	Slovakia	48.74	19.15
Bratislava	Slovakia	48.15	17.11
Košice	Slovakia	48.71	21.26
Nitra	Slovakia	48.31	18.08
Prešov	Slovakia	49.00	21.23
Trenčín	Slovakia	48.89	18.04
Trnava	Slovakia	48.38	17.59
Žilina	Slovakia	49.22	18.74
Celje	Slovenia	46.23	15.26
Kranj	Slovenia	46.24	14.36
Ljubljana	Slovenia	46.05	14.51
Maribor	Slovenia	46.55	15.65
Velenje	Slovenia	46.36	15.11
Honiara	Solomon Islands	-9.43	159.95
Baidoa	Somalia	3.11	43.65
Beledweyne	Somalia	4.74	45.20
Bosaso	Somalia	11.28	49.18
Burao	Somalia	9.52	45.53
Ceerigaabo	Somalia	10.62	47.37
Gaalkacyo	Somalia	6.77	47.43
Garoowe	Somalia	8.40	48.48
Hargeysa	Somalia	9.56	44.06
Jawhar	Somalia	2.78	45.50
Kismayo	Somalia	-0.36	42.55
Laascaanood	Somalia	8.48	47.36
Marka	Somalia	1.72	44.77
Mogadishu	Somalia	2.04	45.34
Benoni	South Africa	-26.19	28.32
Bhisho	South Africa	-32.85	27.44
Bloemfontein	South Africa	-29.12	26.21
Boksburg	South Africa	-26.21	28.26
Botshabelo	South Africa	-29.27	26.73
Brakpan	South Africa	-26.24	28.37
Cape Town	South Africa	-33.93	18.42
Diepsloot	South Africa	-25.93	28.01
Durban	South Africa	-29.86	31.03
East London	South Africa	-33.02	27.91
Johannesburg	South Africa	-26.20	28.04
Kimberley	South Africa	-28.73	24.76
Krugersdorp	South Africa	-26.09	27.78
Nelspruit	South Africa	-25.47	30.97
Newcastle	South Africa	-27.76	29.93
Pietermaritzburg	South Africa	-29.62	30.39
Polokwane	South Africa	-23.90	29.47
Port Elizabeth	South Africa	-33.96	25.61
Pretoria	South Africa	-25.74	28.19
Randburg	South Africa	-26.09	28.00
Richards Bay	South Africa	-28.78	32.04
Soweto	South Africa	-26.27	27.86
Tembisa	South Africa	-26.00	28.23
Vereeniging	South Africa	-26.67	27.93
Welkom	South Africa	-27.98	26.74
Witbank	South Africa	-25.87	29.23
Grytviken	South Georgia & South Sandwich Islands	-54.28	-36.51
Andong	South Korea	36.57	128.72
Ansan-si	South Korea	37.32	126.82
Anyang-si	South Korea	37.39	126.93
Bucheon-si	South Korea	37.50	126.78
Busan	South Korea	35.10	129.03
Changwon	South Korea	35.23	128.68
Cheonan	South Korea	36.81	127.15
Cheongju-si	South Korea	36.64	127.49
Chinju	South Korea	35.19	128.08
Chuncheon	South Korea	37.87	127.73
Daegu	South Korea	35.87	128.59
Daejeon	South Korea	36.35	127.38
Goyang-si	South Korea	37.66	126.83
Gumi	South Korea	36.11	128.34
Gwangju	South Korea	35.15	126.92
Hongseong	South Korea	36.60	126.67
Hwaseong-si	South Korea	37.21	126.82
Iksan	South Korea	35.94	126.95
Incheon	South Korea	37.46	126.71
Jeju City	South Korea	33.51	126.52
Jeonju	South Korea	35.82	127.15
Kimhae	South Korea	35.23	128.88
Kwangmyŏng	South Korea	37.48	126.87
Masan	South Korea	35.13	126.83
Mokpo	South Korea	34.81	126.39
Muan	South Korea	34.99	126.48
Pohang	South Korea	36.03	129.36
Sejong	South Korea	36.59	127.29
Seongnam-si	South Korea	37.44	127.14
Seoul	South Korea	37.57	126.98
Suwon	South Korea	37.29	127.01
Uijeongbu-si	South Korea	37.74	127.05
Ulsan	South Korea	35.54	129.32
Yeosu	South Korea	34.76	127.66
Aweil	South Sudan	8.76	27.39
Bor	South Sudan	6.21	31.56
Juba	South Sudan	4.85	31.58
Malakal	South Sudan	9.53	31.66
Rumbek	South Sudan	6.81	29.68
Wau	South Sudan	7.70	27.99
Winejok	South Sudan	9.01	27.57
Yambio	South Sudan	4.57	28.39
Yei	South Sudan	4.09	30.68
Alicante	Spain	38.35	-0.48
Barcelona	Spain	41.39	2.16
Bilbao	Spain	43.26	-2.93
Carabanchel	Spain	40.39	-3.72
Ceuta	Spain	35.89	-5.32
Córdoba	Spain	37.89	-4.77
Eixample	Spain	41.39	2.16
Gasteiz / Vitoria	Spain	42.85	-2.67
Gijón	Spain	43.54	-5.66
L'Hospitalet de Llobregat	Spain	41.36	2.10
Las Palmas de Gran Canaria	Spain	28.10	-15.41
Latina	Spain	40.39	-3.75
Logroño	Spain	42.47	-2.45
Madrid	Spain	40.42	-3.70
Málaga	Spain	36.72	-4.42
Melilla	Spain	35.29	-2.94
Mérida	Spain	38.92	-6.34
Murcia	Spain	37.99	-1.13
Oviedo	Spain	43.36	-5.84
Palma	Spain	39.57	2.65
Pamplona	Spain	42.82	-1.64
Santa Cruz de Tenerife	Spain	28.47	-16.25
Santander	Spain	43.46	-3.80
Santiago de Compostela	Spain	42.88	-8.55
Sevilla	Spain	37.38	-5.97
Toledo	Spain	39.86	-4.02
Valencia	Spain	39.47	-0.38
Valladolid	Spain	41.66	-4.72
Vigo	Spain	42.23	-8.72
Zaragoza	Spain	41.66	-0.88
Anuradhapura	Sri Lanka	8.31	80.41
Badulla	Sri Lanka	6.98	81.06
Colombo	Sri Lanka	6.94	79.85
Galle	Sri Lanka	6.05	80.21
Jaffna	Sri Lanka	9.67	80.01
Kandy	Sri Lanka	7.29	80.63
Kurunegala	Sri Lanka	7.48	80.37
Ratnapura	Sri Lanka	6.69	80.40
Trincomalee	Sri Lanka	8.58	81.23
Gustavia	St. Barthélemy	17.90	-62.85
Jamestown	St. Helena	-15.94	-5.72
Basseterre	St. Kitts & Nevis	17.30	-62.72
Castries	St. Lucia	14.00	-61.01
Marigot	St. Martin	18.07	-63.08
Saint-Pierre	St. Pierre & Miquelon	46.78	-56.18
Kingstown	St. Vincent & Grenadines	13.16	-61.23
Ad-Damazin	Sudan	11.79	34.36
Al Qadarif	Sudan	14.03	35.38
Ed Damer	Sudan	17.60	33.97
El Daein	Sudan	11.46	26.13
El Fasher	Sudan	13.63	25.35
El Obeid	Sudan	13.18	30.22
Geneina	Sudan	13.45	22.45
Kadugli	Sudan	11.01	29.72
Kassala	Sudan	15.45	36.40
Khartoum	Sudan	15.55	32.53
Kosti	Sudan	13.16	32.66
Nyala	Sudan	12.05	24.88
Omdurman	Sudan	15.64	32.48
Port Sudan	Sudan	19.62	37.22
Rabak	Sudan	13.18	32.74
Singa	Sudan	13.15	33.93
Wad Medani	Sudan	14.40	33.52
Zalingei	Sudan	12.91	23.47
Paramaribo	Suriname	5.87	-55.17
Longyearbyen	Svalbard & Jan Mayen	78.22	15.65
Falun	Sweden	60.60	15.63
Gävle	Sweden	60.67	17.14
Göteborg	Sweden	57.71	11.97
Halmstad	Sweden	56.67	12.86
Jönköping	Sweden	57.78	14.16
Kalmar	Sweden	56.66	16.36
Karlskrona	Sweden	56.16	15.59
Karlstad	Sweden	59.38	13.50
Linköping	Sweden	58.41	15.62
Luleå	Sweden	65.58	22.15
Malmö	Sweden	55.61	13.00
Nyköping	Sweden	58.75	17.01
Örebro	Sweden	59.27	15.21
Östersund	Sweden	63.18	14.64
Stockholm	Sweden	59.33	18.07
Umeå	Sweden	63.83	20.26
Uppsala	Sweden	59.86	17.64
Västerås	Sweden	59.62	16.55
Växjö	Sweden	56.88	14.81
Basel	Switzerland	47.56	7.57
Bern	Switzerland	46.95	7.45
Chur	Switzerland	46.85	9.53
Fribourg	Switzerland	46.80	7.15
Genève	Switzerland	46.20	6.15
Lausanne	Switzerland	46.52	6.63
Luzern	Switzerland	47.05	8.31
Neuchâtel	Switzerland	46.99	6.93
Sankt Gallen	Switzerland	47.42	9.37
Schaffhausen	Switzerland	47.70	8.63
Sitten	Switzerland	46.23	7.36
Zürich	Switzerland	47.37	8.55
Al Ḩasakah	Syria	36.50	40.75
Al Qunayţirah	Syria	33.13	35.82
Aleppo	Syria	36.20	37.16
Ar Raqqah	Syria	35.95	39.01
As-Suwayda	Syria	32.71	36.57
Damascus	Syria	33.51	36.29
Dar‘ā	Syria	32.62	36.10
Deir ez-Zor	Syria	35.34	40.14
Ḩamāh	Syria	35.13	36.76
Homs	Syria	34.73	36.72
Idlib	Syria	35.93	36.63
Latakia	Syria	35.53	35.79
Tartouss	Syria	34.89	35.89
Banqiao	Taiwan	25.01	121.47
Hsinchu	Taiwan	24.80	120.97
Hualien City	Taiwan	23.98	121.60
Jincheng	Taiwan	24.43	118.32
Kaohsiung	Taiwan	22.62	120.31
Keelung	Taiwan	25.13	121.74
Taichung	Taiwan	24.15	120.68
Tainan	Taiwan	22.99	120.21
Taipei	Taiwan	25.05	121.53
Taoyuan City	Taiwan	24.99	121.30
Zhongxing New Village	Taiwan	23.96	120.69
Dushanbe	Tajikistan	38.54	68.78
Khorugh	Tajikistan	37.49	71.55
Khujand	Tajikistan	40.28	69.62
Qŭrghonteppa	Tajikistan	37.83	68.78
Arusha	Tanzania	-3.37	36.68
Babati	Tanzania	-4.22	35.75
Bukoba	Tanzania	-1.33	31.81
Dar es Salaam	Tanzania	-6.82	39.27
Dodoma	Tanzania	-6.17	35.74
Geita	Tanzania	-2.87	32.23
Iringa	Tanzania	-7.77	35.70
Kigoma	Tanzania	-4.88	29.63
Lindi	Tanzania	-10.00	39.72
Mbeya	Tanzania	-8.90	33.45
Morogoro	Tanzania	-6.82	37.66
Moshi	Tanzania	-3.35	37.33
Mpanda	Tanzania	-6.34	31.07
Mtwara	Tanzania	-10.27	40.18
Musoma	Tanzania	-1.50	33.80
Mwanza	Tanzania	-2.52	32.90
Njombe	Tanzania	-9.35	34.77
Shinyanga	Tanzania	-3.66	33.42
Singida	Tanzania	-4.82	34.74
Songea	Tanzania	-10.68	35.65
Sumbawanga	Tanzania	-7.97	31.62
Tabora	Tanzania	-5.02	32.83
Tanga	Tanzania	-5.07	39.10
Vwawa	Tanzania	-9.11	32.93
Wete	Tanzania	-5.06	39.73
Zanzibar	Tanzania	-6.16	39.20
Amnat Charoen	Thailand	15.86	104.63
Bangkok	Thailand	13.75	100.50
Buri Ram	Thailand	14.99	103.10
Chachoengsao	Thailand	13.69	101.07
Chaiyaphum	Thailand	15.81	102.03
Chanthaburi	Thailand	12.61	102.10
Chiang Mai	Thailand	18.79	98.98
Chiang Rai	Thailand	19.91	99.83
Chon Buri	Thailand	13.36	100.98
Chumphon	Thailand	10.50	99.18
Kalasin	Thailand	16.43	103.51
Kamphaeng Phet	Thailand	16.48	99.52
Kanchanaburi	Thailand	14.00	99.55
Khon Kaen	Thailand	16.45	102.83
Krabi	Thailand	8.07	98.91
Lampang	Thailand	18.29	99.49
Lamphun	Thailand	18.58	99.01
Loei	Thailand	17.49	101.73
Lop Buri	Thailand	14.80	100.65
Maha Sarakham	Thailand	16.18	103.30
Mueang Nonthaburi	Thailand	13.86	100.51
Mukdahan	Thailand	16.55	104.72
Nakhon Pathom	Thailand	13.82	100.04
Nakhon Phanom	Thailand	17.41	104.78
Nakhon Ratchasima	Thailand	14.97	102.10
Nakhon Sawan	Thailand	15.70	100.14
Nakhon Si Thammarat	Thailand	8.43	99.97
Narathiwat	Thailand	6.43	101.82
Nong Bua Lamphu	Thailand	17.20	102.44
Nong Khai	Thailand	17.88	102.74
Pattani	Thailand	6.87	101.25
Phatthalung	Thailand	7.62	100.08
Phetchabun	Thailand	16.42	101.16
Phetchaburi	Thailand	13.11	99.94
Phichit	Thailand	16.44	100.35
Phitsanulok	Thailand	16.82	100.26
Phra Nakhon Si Ayutthaya	Thailand	14.35	100.58
Phrae	Thailand	18.15	100.14
Phuket	Thailand	7.89	98.40
Prachin Buri	Thailand	14.05	101.37
Prachuap Khiri Khan	Thailand	11.82	99.78
Ratchaburi	Thailand	13.54	99.82
Rayong	Thailand	12.68	101.26
Roi Et	Thailand	16.06	103.65
Sa Kaeo	Thailand	13.81	102.07
Sakon Nakhon	Thailand	17.16	104.15
Samut Prakan	Thailand	13.60	100.60
Samut Sakhon	Thailand	13.55	100.27
Samut Songkhram	Thailand	13.41	100.00
Saraburi	Thailand	14.53	100.92
Satun	Thailand	6.62	100.07
Si Sa Ket	Thailand	15.11	104.33
Songkhla	Thailand	7.20	100.60
Sukhothai	Thailand	17.01	99.82
Suphan Buri	Thailand	14.47	100.12
Surat Thani	Thailand	9.14	99.33
Surin	Thailand	14.88	103.49
Trang	Thailand	7.56	99.61
Ubon Ratchathani	Thailand	15.24	104.85
Udon Thani	Thailand	17.42	102.79
Uttaradit	Thailand	17.63	100.09
Yala	Thailand	6.54	101.28
Dili	Timor-Leste	-8.56	125.57
Memphis	TN	35.15	-90.05
Nashville	TN	36.17	-86.78
New South Memphis	TN	35.09	-90.06
Atakpamé	Togo	7.53	1.13
Dapaong	Togo	10.86	0.21
Kara	Togo	9.55	1.19
Lomé	Togo	6.13	1.22
Sokodé	Togo	8.98	1.13
Nuku‘alofa	Tonga	-21.14	-175.20
Arima	Trinidad & Tobago	10.64	-61.28
Chaguanas	Trinidad & Tobago	10.52	-61.42
Port of Spain	Trinidad & Tobago	10.67	-61.52
Rio Claro	Trinidad & Tobago	10.31	-61.18
San Fernando	Trinidad & Tobago	10.28	-61.47
Ariana	Tunisia	36.86	10.19
Béja	Tunisia	36.73	9.18
Ben Arous	Tunisia	36.75	10.22
Bizerte	Tunisia	37.27	9.87
El Kef	Tunisia	36.17	8.70
Gabès	Tunisia	33.88	10.10
Gafsa	Tunisia	34.42	8.78
Jendouba	Tunisia	36.50	8.78
Kairouan	Tunisia	35.68	10.10
Kasserine	Tunisia	35.17	8.84
Mahdia	Tunisia	35.50	11.06
Medenine	Tunisia	33.35	10.51
Monastir	Tunisia	35.78	10.83
Nabeul	Tunisia	36.46	10.74
Sfax	Tunisia	34.74	10.76
Sidi Bouzid	Tunisia	35.04	9.48
Siliana	Tunisia	36.08	9.37
Sousse	Tunisia	35.83	10.64
Tataouine	Tunisia	32.93	10.45
Tozeur	Tunisia	33.92	8.13
Tunis	Tunisia	36.82	10.17
Adana	Türkiye	36.99	35.33
Adapazarı	Türkiye	40.78	30.40
Adıyaman	Türkiye	37.76	38.28
Afyonkarahisar	Türkiye	38.76	30.54
Ağrı	Türkiye	39.72	43.05
Aksaray	Türkiye	38.37	34.03
Amasya	Türkiye	40.65	35.83
Ankara	Türkiye	39.92	32.85
Antakya	Türkiye	36.21	36.16
Antalya	Türkiye	36.91	30.70
Ataşehir	Türkiye	40.98	29.12
Aydın	Türkiye	37.85	27.84
Bağcılar	Türkiye	41.04	28.86
Bahçelievler	Türkiye	41.00	28.86
Balıkesir	Türkiye	39.65	27.89
Bartın	Türkiye	41.64	32.34
Batikent	Türkiye	39.97	32.73
Batman	Türkiye	37.89	41.13
Bayburt	Türkiye	40.26	40.22
Bilecik	Türkiye	40.14	29.98
Bingöl	Türkiye	38.88	40.49
Bitlis	Türkiye	38.40	42.11
Bolu	Türkiye	40.74	31.61
Burdur	Türkiye	37.72	30.29
Bursa	Türkiye	40.20	29.06
Çanakkale	Türkiye	40.16	26.41
Çankaya	Türkiye	39.92	32.86
Çorum	Türkiye	40.55	34.95
Denizli	Türkiye	37.77	29.09
Diyarbakır	Türkiye	37.91	40.22
Düzce	Türkiye	40.84	31.16
Edirne	Türkiye	41.68	26.56
Elazığ	Türkiye	38.67	39.22
Erzincan	Türkiye	39.74	39.49
Erzurum	Türkiye	39.91	41.28
Esenler	Türkiye	41.04	28.88
Eskişehir	Türkiye	39.78	30.52
Gaziantep	Türkiye	37.06	37.38
Gebze	Türkiye	40.80	29.43
Giresun	Türkiye	40.92	38.39
Gumushkhane	Türkiye	40.46	39.47
Hakkâri	Türkiye	37.57	43.74
Iğdır	Türkiye	39.92	44.05
Isparta	Türkiye	37.76	30.55
Istanbul	Türkiye	41.01	28.95
İzmir	Türkiye	38.41	27.14
İzmit	Türkiye	40.76	29.93
Kahramanmaraş	Türkiye	37.58	36.93
Karabağlar	Türkiye	38.37	27.14
Karabük	Türkiye	41.20	32.63
Karaman	Türkiye	37.18	33.22
Kars	Türkiye	40.60	43.09
Kastamonu	Türkiye	41.38	33.78
Kayseri	Türkiye	38.73	35.49
Khanjarah	Türkiye	40.60	33.62
Kilis	Türkiye	36.72	37.12
Kırıkkale	Türkiye	39.85	33.51
Kırklareli	Türkiye	41.74	27.23
Kırşehir	Türkiye	39.15	34.16
Konya	Türkiye	37.87	32.48
Kütahya	Türkiye	39.42	29.98
Malatya	Türkiye	38.35	38.32
Maltepe	Türkiye	40.94	29.16
Manisa	Türkiye	38.61	27.43
Mardin	Türkiye	37.31	40.74
Merkezefendi	Türkiye	37.81	29.04
Mersin	Türkiye	36.81	34.64
Muğla	Türkiye	37.22	28.37
Muratpaşa	Türkiye	36.89	30.76
Muş	Türkiye	38.73	41.48
Nevşehir	Türkiye	38.63	34.71
Niğde	Türkiye	37.97	34.68
Ordu	Türkiye	40.98	37.89
Osmaniye	Türkiye	37.07	36.25
Rize	Türkiye	41.02	40.52
Samsun	Türkiye	41.28	36.34
Şanlıurfa	Türkiye	37.17	38.79
Siirt	Türkiye	37.93	41.94
Sinop	Türkiye	42.03	35.16
Şişli	Türkiye	41.06	28.99
Sivas	Türkiye	39.75	37.02
Şırnak	Türkiye	37.51	42.45
Sultanbeyli	Türkiye	40.96	29.27
Sultangazi	Türkiye	41.11	28.87
Tarsus	Türkiye	36.92	34.89
Tekirdağ	Türkiye	40.98	27.51
Tokat	Türkiye	40.31	36.55
Trabzon	Türkiye	41.01	39.73
Tunceli	Türkiye	39.10	39.54
Umraniye	Türkiye	41.02	29.12
Uşak	Türkiye	38.67	29.41
Üsküdar	Türkiye	41.02	29.01
Van	Türkiye	38.49	43.38
Yalova	Türkiye	40.66	29.28
Yozgat	Türkiye	39.82	34.80
Zeytinburnu	Türkiye	40.99	28.90
Zonguldak	Türkiye	41.45	31.79
Annau	Turkmenistan	37.89	58.52
Ashgabat	Turkmenistan	37.95	58.38
Balkanabat	Turkmenistan	39.51	54.37
Daşoguz	Turkmenistan	41.84	59.97
Mary	Turkmenistan	37.59	61.83
Türkmenabat	Turkmenistan	39.07	63.58
Cockburn Town	Turks & Caicos Islands	21.46	-71.14
Funafuti	Tuvalu	-8.52	179.19
Arlington	TX	32.74	-97.11
Austin	TX	30.27	-97.74
Corpus Christi	TX	27.80	-97.40
Dallas	TX	32.78	-96.81
El Paso	TX	31.76	-106.49
Fort Worth	TX	32.73	-97.32
Houston	TX	29.76	-95.36
Laredo	TX	27.51	-99.51
Plano	TX	33.02	-96.70
San Antonio	TX	29.42	-98.49
Charlotte Amalie	U.S. Virgin Islands	18.34	-64.93
Saint Croix	U.S. Virgin Islands	17.73	-64.75
Gulu	Uganda	2.77	32.30
Jinja	Uganda	0.44	33.20
Kampala	Uganda	0.32	32.58
Mbarara	Uganda	-0.60	30.65
Cherkasy	Ukraine	49.43	32.06
Chernihiv	Ukraine	51.51	31.28
Chernivtsi	Ukraine	48.29	25.94
Dnipro	Ukraine	48.46	35.04
Donetsk	Ukraine	48.02	37.80
Horlivka	Ukraine	48.34	38.05
Ivano-Frankivsk	Ukraine	48.92	24.71
Kharkiv	Ukraine	49.98	36.25
Kherson	Ukraine	46.66	32.62
Khmelnytskyi	Ukraine	49.42	27.00
Kropyvnytskyi	Ukraine	48.51	32.26
Kryvyi Rih	Ukraine	47.91	33.38
Kyiv	Ukraine	50.45	30.52
Luhansk	Ukraine	48.57	39.32
Lutsk	Ukraine	50.76	25.34
Lviv	Ukraine	49.84	24.02
Makiyivka	Ukraine	48.05	37.93
Mariupol	Ukraine	47.10	37.54
Mykolayiv	Ukraine	46.97	32.00
Odessa	Ukraine	46.48	30.73
Poltava	Ukraine	49.59	34.54
Rivne	Ukraine	50.62	26.23
Sevastopol	Ukraine	44.61	33.52
Simferopol	Ukraine	44.96	34.11
Sumy	Ukraine	50.92	34.80
Ternopil	Ukraine	49.55	25.59
Uzhgorod	Ukraine	48.62	22.30
Vinnytsia	Ukraine	49.23	28.48
Zaporizhia	Ukraine	47.82	35.19
Zhytomyr	Ukraine	50.26	28.68
Abu Dhabi	United Arab Emirates	24.45	54.40
Ajman City	United Arab Emirates	25.40	55.48
Al Fujairah City	United Arab Emirates	25.12	56.34
Dubai	United Arab Emirates	25.08	55.31
Ras Al Khaimah City	United Arab Emirates	25.79	55.94
Sharjah	United Arab Emirates	25.34	55.41
Umm Al Quwain City	United Arab Emirates	25.56	55.56
Belfast	United Kingdom	54.60	-5.93
Birkenhead	United Kingdom	53.39	-3.01
Birmingham	United Kingdom	52.48	-1.90
Bradford	United Kingdom	53.79	-1.75
Brent	United Kingdom	51.55	-0.30
Bristol	United Kingdom	51.46	-2.60
Cardiff	United Kingdom	51.48	-3.18
Coventry	United Kingdom	52.41	-1.51
Derby	United Kingdom	52.92	-1.48
Edinburgh	United Kingdom	55.95	-3.20
Glasgow	United Kingdom	55.87	-4.26
Islington	United Kingdom	51.54	-0.10
Kingston upon Hull	United Kingdom	53.74	-0.34
Leeds	United Kingdom	53.80	-1.55
Leicester	United Kingdom	52.64	-1.13
Liverpool	United Kingdom	53.41	-2.98
London	United Kingdom	51.51	-0.13
Luton	United Kingdom	51.88	-0.42
Manchester	United Kingdom	53.48	-2.24
Newport	United Kingdom	51.59	-3.00
Nottingham	United Kingdom	52.95	-1.15
Plymouth	United Kingdom	50.37	-4.14
Preston	United Kingdom	53.76	-2.70
Reading	United Kingdom	51.46	-0.97
Sheffield	United Kingdom	53.38	-1.47
Southend-on-Sea	United Kingdom	51.54	0.71
Stoke-on-Trent	United Kingdom	53.00	-2.19
Sunderland	United Kingdom	54.90	-1.38
Swansea	United Kingdom	51.62	-3.94
Wolverhampton	United Kingdom	52.59	-2.12
Artigas	Uruguay	-30.40	-56.47
Durazno	Uruguay	-33.38	-56.52
Florida	Uruguay	-34.10	-56.21
Maldonado	Uruguay	-34.90	-54.95
Melo	Uruguay	-32.37	-54.17
Mercedes	Uruguay	-33.25	-58.03
Minas	Uruguay	-34.38	-55.24
Montevideo	Uruguay	-34.90	-56.19
Paysandú	Uruguay	-32.32	-58.08
Rivera	Uruguay	-30.91	-55.55
Rocha	Uruguay	-34.48	-54.33
Salto	Uruguay	-31.38	-57.97
San José de Mayo	Uruguay	-34.34	-56.71
Tacuarembó	Uruguay	-31.72	-55.98
Treinta y Tres	Uruguay	-33.23	-54.38
Salt Lake City	UT	40.76	-111.89
Andijon	Uzbekistan	40.78	72.34
Bukhara	Uzbekistan	39.77	64.43
Fergana	Uzbekistan	40.38	71.78
Guliston	Uzbekistan	40.49	68.78
Jizzax	Uzbekistan	40.12	67.83
Namangan	Uzbekistan	41.00	71.67
Navoiy	Uzbekistan	40.08	65.38
Nukus	Uzbekistan	42.45	59.61
Qarshi	Uzbekistan	38.86	65.79
Samarkand	Uzbekistan	39.65	66.96
Tashkent	Uzbekistan	41.26	69.22
Tirmiz	Uzbekistan	37.22	67.28
Urganch	Uzbekistan	41.55	60.63
Port-Vila	Vanuatu	-17.74	168.31
Richmond	VA	37.55	-77.46
Vatican City	Vatican City	41.90	12.45
Virginia Beach	VA	36.85	-75.98
Alto Barinas	Venezuela	8.59	-70.23
Barcelona	Venezuela	10.14	-64.69
Barinas	Venezuela	8.62	-70.21
Barquisimeto	Venezuela	10.06	-69.36
Caracas	Venezuela	10.49	-66.88
Ciudad Bolívar	Venezuela	8.13	-63.54
Ciudad Guayana	Venezuela	8.35	-62.64
Coro	Venezuela	11.40	-69.67
Cumaná	Venezuela	10.45	-64.18
Guanare	Venezuela	9.04	-69.74
La Asunción	Venezuela	11.03	-63.86
La Guaira	Venezuela	10.60	-66.93
Los Teques	Venezuela	10.34	-67.04
Maracaibo	Venezuela	10.67	-71.61
Maracay	Venezuela	10.24	-67.59
Maturín	Venezuela	9.75	-63.18
Mérida	Venezuela	8.59	-71.16
Petare	Venezuela	10.48	-66.81
Puerto Ayacucho	Venezuela	5.66	-67.58
Puerto La Cruz	Venezuela	10.21	-64.63
San Carlos	Venezuela	9.66	-68.58
San Cristóbal	Venezuela	7.77	-72.22
San Felipe	Venezuela	10.34	-68.74
San Fernando de Apure	Venezuela	7.89	-67.47
San Juan de los Morros	Venezuela	9.91	-67.35
Santa Teresa del Tuy	Venezuela	10.23	-66.66
Trujillo	Venezuela	9.37	-70.44
Tucupita	Venezuela	9.06	-62.05
Turmero	Venezuela	10.23	-67.47
Valencia	Venezuela	10.16	-68.01
Bắc Giang	Vietnam	21.27	106.19
Bạc Liêu	Vietnam	9.29	105.73
Bắc Ninh	Vietnam	21.19	106.08
Bến Tre	Vietnam	10.24	106.38
Biên Hòa	Vietnam	10.94	106.82
Buôn Ma Thuột	Vietnam	12.67	108.04
Cà Mau	Vietnam	9.18	105.15
Cần Thơ	Vietnam	10.04	105.79
Cao Bằng	Vietnam	22.67	106.26
Cao Lãnh	Vietnam	10.46	105.63
Ðà Lạt	Vietnam	11.95	108.44
Da Nang	Vietnam	16.07	108.22
Dien Bien Phu	Vietnam	21.39	103.02
Hà Giang	Vietnam	22.82	104.98
Hạ Long	Vietnam	20.95	107.07
Hà Tĩnh	Vietnam	18.34	105.91
Hải Dương	Vietnam	20.94	106.33
Haiphong	Vietnam	20.86	106.68
Hanoi	Vietnam	21.02	105.84
Ho Chi Minh City	Vietnam	10.82	106.63
Hòa Bình	Vietnam	20.82	105.34
Huế	Vietnam	16.46	107.60
Hưng Yên	Vietnam	20.65	106.05
Kon Tum	Vietnam	14.35	108.01
Kwang Binh	Vietnam	17.47	106.62
Lạng Sơn	Vietnam	21.85	106.76
Lào Cai	Vietnam	22.49	103.97
Long Xuyên	Vietnam	10.39	105.44
Mỹ Tho	Vietnam	10.36	106.36
Nam Định	Vietnam	20.43	106.18
Nha Trang	Vietnam	12.25	109.19
Ninh Bình	Vietnam	20.26	105.98
Phan Rang-Tháp Chàm	Vietnam	11.56	108.99
Phan Thiết	Vietnam	10.93	108.10
Phủ Lý	Vietnam	20.55	105.91
Pleiku	Vietnam	13.98	108.00
Quảng Ngãi	Vietnam	15.12	108.79
Qui Nhon	Vietnam	13.78	109.22
Rạch Giá	Vietnam	10.01	105.08
Sóc Trăng	Vietnam	9.60	105.97
Tam Kỳ	Vietnam	15.57	108.47
Tân An	Vietnam	10.54	106.41
Tây Ninh	Vietnam	11.31	106.10
Thái Bình	Vietnam	20.45	106.34
Thái Nguyên	Vietnam	21.59	105.85
Thanh Hóa	Vietnam	19.80	105.77
Thủ Dầu Một	Vietnam	10.98	106.65
Trà Vinh	Vietnam	9.95	106.34
Tuy Hòa	Vietnam	13.10	109.32
Tuyên Quang	Vietnam	21.82	105.21
Việt Trì	Vietnam	21.32	105.40
Vinh	Vietnam	18.67	105.69
Vĩnh Long	Vietnam	10.25	105.97
Yên Bái	Vietnam	21.72	104.91
Mata-Utu	Wallis & Futuna	-13.28	-176.17
Olympia	WA	47.04	-122.90
Seattle	WA	47.61	-122.33
Dakhla	Western Sahara	23.68	-15.96
Laayoune	Western Sahara	27.14	-13.19
Madison	WI	43.07	-89.40
Milwaukee	WI	43.04	-87.91
Charleston	WV	38.35	-81.63
Cheyenne	WY	41.14	-104.82
‘Amrān	Yemen	15.66	43.94
Aden	Yemen	12.78	45.04
Al Bayda	Yemen	13.99	45.57
Al Ḩudaydah	Yemen	14.80	42.95
Ataq	Yemen	14.54	46.83
Dhamār	Yemen	14.54	44.41
Ḩajjah	Yemen	15.69	43.61
Ibb	Yemen	13.97	44.18
Mukalla	Yemen	14.54	49.12
Sa'dah	Yemen	16.94	43.76
Sanaa	Yemen	15.35	44.21
Ta‘izz	Yemen	13.58	44.02
Chipata	Zambia	-13.63	32.65
Choma	Zambia	-16.81	26.99
Kabwe	Zambia	-14.45	28.45
Kasama	Zambia	-10.21	31.18
Kitwe	Zambia	-12.80	28.21
Lusaka	Zambia	-15.41	28.29
Mansa	Zambia	-11.20	28.89
Mongu	Zambia	-15.25	23.13
Ndola	Zambia	-12.96	28.64
Bindura	Zimbabwe	-17.30	31.33
Bulawayo	Zimbabwe	-20.15	28.58
Chinhoyi	Zimbabwe	-17.37	30.20
Chitungwiza	Zimbabwe	-18.01	31.08
Gweru	Zimbabwe	-19.45	29.82
Harare	Zimbabwe	-17.83	31.05
Marondera	Zimbabwe	-18.19	31.55
Masvingo	Zimbabwe	-20.06	30.83
Mutare	Zimbabwe	-18.97	32.67`;

let cache: MajorCity[] | null = null;

function majorCities(): MajorCity[] {
  if (cache) return cache;
  cache = ROWS.split('\n').map((line) => {
    const [name, region, lat, lon] = line.split('\t');
    return { name, region, lat: Number(lat), lon: Number(lon) };
  });
  return cache;
}

const EARTH_NM = 3440.065; // mean radius in nautical miles
const rad = (d: number): number => (d * Math.PI) / 180;

const haversineNm = (f1: number, f2: number, dl: number): number => {
  const sinHalfLat = Math.sin((f2 - f1) / 2);
  const sinHalfLon = Math.sin(dl / 2);
  const h = sinHalfLat * sinHalfLat + Math.cos(f1) * Math.cos(f2) * sinHalfLon * sinHalfLon;
  return 2 * EARTH_NM * Math.asin(Math.min(1, Math.sqrt(h)));
};

// Nearest major city to a position, by great-circle distance, with the
// bearing from that city toward the position (for "120 nm NE of Suva").
// Exact haversine scan over ~3k rows — well under a millisecond, and only
// run once per ship per snapshot.
export function nearestMajorCity(lat: number, lon: number): NearestCity | null {
  const f2 = rad(lat);
  let best: MajorCity | null = null;
  let bestDist = Infinity;
  for (const c of majorCities()) {
    const d = haversineNm(rad(c.lat), f2, rad(lon - c.lon));
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  if (!best) return null;

  const f1 = rad(best.lat);
  const dl = rad(lon - best.lon);
  const bearing =
    (Math.atan2(
      Math.sin(dl) * Math.cos(f2),
      Math.cos(f1) * Math.sin(f2) - Math.sin(f1) * Math.cos(f2) * Math.cos(dl)
    ) *
      180) /
      Math.PI;
  return { city: best, distNm: bestDist, bearingDeg: (bearing + 360) % 360 };
}
