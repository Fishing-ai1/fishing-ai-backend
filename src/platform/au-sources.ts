// Official entry points checked 2026-09-09. This registry is not a live feed or a reuse licence.
export const AU_SOURCES = [
 {id:'au-qld-fisheries',name:'Queensland recreational fishing rules',subdivision:'QLD',source_url:'https://www.qld.gov.au/recreation/activities/boating-fishing/rec-fishing/rules'},
 {id:'au-nsw-fisheries',name:'NSW recreational fishing rules',subdivision:'NSW',source_url:'https://www.dpi.nsw.gov.au/fishing/recreational/fishing-rules-and-regs'},
 {id:'au-vic-fisheries',name:'Victorian Fisheries Authority',subdivision:'VIC',source_url:'https://vfa.vic.gov.au/recreational-fishing/recreational-fishing-guide'},
 {id:'au-wa-fisheries',name:'Western Australian recreational fishing rules',subdivision:'WA',source_url:'https://rules.fish.wa.gov.au/'},
 {id:'au-sa-fisheries',name:'PIRSA recreational fishing rules',subdivision:'SA',source_url:'https://pir.sa.gov.au/fishing-and-aquaculture/recreational-fishing/rules'},
 {id:'au-tas-fisheries',name:'Fishing Tasmania marine recreational rules',subdivision:'TAS',source_url:'https://fishing.tas.gov.au/recreational-fishing/rules/size-and-bag-limits'},
 {id:'au-nt-fisheries',name:'Northern Territory area fishing rules',subdivision:'NT',source_url:'https://nt.gov.au/marine/recreational-fishing/when-and-where-to-fish/rules-for-fishing-in-specific-areas'},
 {id:'au-act-fisheries',name:'ACT recreational fishing',subdivision:'ACT',source_url:'https://www.act.gov.au/environment/animals-and-plants/animals/wildlife-management/fish/recreational-fishing-in-the-act'},
 {id:'au-gbrmpa',name:'Great Barrier Reef Marine Park Authority zoning',subdivision:'QLD',source_url:'https://www.gbrmpa.gov.au/access/zoning/zoning-maps'},
 {id:'au-australian-museum',name:'Australian Museum fish knowledge',subdivision:null,source_url:'https://australian.museum/learn/animals/fishes/'},
].map(source=>({...source,country:'AU',adapter:'reviewed_document',attribution:source.name+'; review source-specific reuse terms. No images or chart layers included.'}));
