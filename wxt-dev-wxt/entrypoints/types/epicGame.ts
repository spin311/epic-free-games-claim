export type EpicKeyImage = { type?: string; url?: string };

export type EpicPromotionOffer = {
    startDate?: string;
    endDate?: string;
    discountSetting?: { discountPercentage?: number };
};

export type EpicElement = {
    title?: string;
    description?: string;
    productSlug?: string;

    price?: {
        totalPrice?: {
            discountPrice?: number;
        };
    };

    promotions?: {
        promotionalOffers?: { promotionalOffers?: EpicPromotionOffer[] }[];
        upcomingPromotionalOffers?: { promotionalOffers?: EpicPromotionOffer[] }[];
    };

    catalogNs?: { mappings?: { pageSlug?: string }[] };
    offerMappings?: { pageSlug?: string }[];

    keyImages?: EpicKeyImage[];
};

export type EpicSearchResponse = {
    data?: {
        Catalog?: {
            searchStore?: {
                elements?: EpicElement[];
            };
        };
    };
};